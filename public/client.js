// TeleTrack Dedicated Client Chat Controller
let currentChannelTag = '';
let channelInfo = null;
let activeChatUserId = null;
let allConversations = [];
let deferredInstallPrompt = null;
let lastRenderedMessagesKey = '';
let lastRenderedConvsKey = '';

// Get Channel Tag from URL
function getChannelTagFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const queryTag = urlParams.get('channel') || urlParams.get('tag');
  if (queryTag) return queryTag.trim();

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'client' && pathParts[1]) {
    return decodeURIComponent(pathParts[1]).trim();
  }
  return '';
}

document.addEventListener('DOMContentLoaded', async () => {
  currentChannelTag = getChannelTagFromUrl();
  
  initPwaInstaller();
  initNotificationToggle();
  initChatEventListeners();
  initChatMediaControls();
  
  if (currentChannelTag) {
    await loadClientInfo();
  }
  
  const isAuth = await checkClientAuth();
  if (isAuth) {
    initSSE();
    loadConversations();
  }
  
  // Auto sync active chat and conversation list in real-time (1.5s interval)
  setInterval(() => {
    if (isClientAuthenticated()) {
      if (activeChatUserId) {
        loadMessages(activeChatUserId);
      }
      loadConversations(true);
    }
  }, 1500);
});

// ─── Client Channel Branding ──────────────────────────────────────────────────
async function loadClientInfo() {
  try {
    const res = await fetch(`/api/client/info/${encodeURIComponent(currentChannelTag)}`);
    const json = await res.json();
    if (json.success && json.data) {
      channelInfo = json.data;
      const brandName = channelInfo.name || `Account (${currentChannelTag})`;
      
      const titleEl = document.getElementById('clientBrandTitle');
      if (titleEl) titleEl.textContent = brandName;

      const pageTitle = document.getElementById('clientPageTitle');
      if (pageTitle) pageTitle.textContent = `${brandName} — Live Support Chat`;

      const badgeEl = document.getElementById('clientBadgeTag');
      if (badgeEl) badgeEl.textContent = channelInfo.tag || currentChannelTag;

      const subtitleEl = document.getElementById('clientBrandSubtitle');
      if (subtitleEl) {
        subtitleEl.textContent = channelInfo.botUsername 
          ? `🤖 @${channelInfo.botUsername} • Real-time Customer Inbox`
          : 'Direct WhatsApp-Style Customer Support';
      }

      const emptyHeading = document.getElementById('clientEmptyHeading');
      if (emptyHeading) emptyHeading.textContent = `${brandName} Live Chat`;
    }
  } catch (err) {
    console.warn('Could not load client info:', err);
  }
}

// ─── Real-Time SSE Stream (0ms Sync) ──────────────────────────────────────────
function initSSE() {
  if (!('EventSource' in window)) return;
  try {
    const es = new EventSource('/api/chat/events');

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'new_message' && payload.message) {
          const msg = payload.message;
          const msgTag = (msg.channelTag || '').toLowerCase();
          const targetTag = (currentChannelTag || '').toLowerCase();
          
          // Check if message belongs to this client channel
          const isOurChannel = !targetTag || 
            msgTag === targetTag || 
            (channelInfo && channelInfo.botUsername && msg.botToken && msg.botToken.startsWith(channelInfo.botToken?.split(':')[0])) ||
            allConversations.some(c => String(c.userId) === String(msg.userId));

          if (!isOurChannel) return;

          const msgConvKey = `${msg.userId}_${msg.channelTag || currentChannelTag || 'default'}`;

          const openUserId = activeChatUserId ? String(activeChatUserId).split('_')[0] : '';
          const incomingUserId = String(msg.userId || msg.userChatId || '');

          // If currently viewing this chat, append message in 0ms
          if (openUserId && openUserId === incomingUserId) {
            appendMessageBubbleDirectly(msg);
            if (activeChatUserId) loadMessages(activeChatUserId);
          } else if (!activeChatUserId && window.innerWidth > 768) {
            selectConversation(msgConvKey);
          }

          // Play Sound & Show Notification if message is from customer
          if (msg.sender === 'user') {
            playNotificationChime();
            showSystemNotification(`New Message from ${msg.userName || 'Customer'}`, msg.text || '[Media]', msg.userId);
          }

          // Refresh conversation list
          loadConversations(true);
        } else if (payload.type === 'new_lead') {
          loadConversations(true);
        }
      } catch (err) {}
    };
  } catch (err) {
    console.warn('SSE error:', err);
  }
}

function renderBubbleContent(m) {
  let contentHtml = '';
  const isImg = m.type === 'image' || (m.mediaUrl && (m.mediaUrl.match(/\.(jpg|jpeg|png|webp|gif)/i) || m.mediaType === 'image'));
  const isVoice = m.type === 'voice' || m.type === 'audio' || (m.mediaUrl && (m.mediaUrl.match(/\.(ogg|oga|webm|mp3|wav|m4a)/i) || m.mediaType === 'voice' || m.mediaType === 'audio'));

  if (isImg && m.mediaUrl) {
    contentHtml += `
      <div class="bubble-image-wrap" onclick="openImageLightbox('${escapeHtml(m.mediaUrl)}')">
        <img class="bubble-image" src="${escapeHtml(m.mediaUrl)}" alt="Photo" loading="lazy" />
      </div>
    `;
  } else if (isVoice && m.mediaUrl) {
    contentHtml += `
      <div class="bubble-audio-wrap">
        <audio class="bubble-audio" controls preload="metadata" src="${escapeHtml(m.mediaUrl)}"></audio>
      </div>
    `;
  }

  if (m.text && m.text !== '[Photo]' && m.text !== '🎤 Voice Message' && m.text !== '[Media / Attachment]') {
    contentHtml += `<div class="bubble-text">${escapeHtml(m.text)}</div>`;
  } else if (!isImg && !isVoice && m.text) {
    contentHtml += `<div class="bubble-text">${escapeHtml(m.text)}</div>`;
  }
  return contentHtml;
}

// Directly append message bubble in 0ms without full DOM reload
function appendMessageBubbleDirectly(m) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  // Prevent duplicate bubble if last bubble is identical
  const lastBubble = container.lastElementChild;
  if (lastBubble) {
    const lastTextEl = lastBubble.querySelector('.bubble-text');
    const lastImgEl = lastBubble.querySelector('.bubble-image');
    const lastAudioEl = lastBubble.querySelector('.bubble-audio');
    const isLastAdmin = lastBubble.classList.contains('bubble-admin');

    const isSameText = (!m.text && !lastTextEl) || (lastTextEl && lastTextEl.textContent.trim() === (m.text || '').trim());
    const isSameMedia = (!m.mediaUrl && !lastImgEl && !lastAudioEl) ||
                        (m.mediaUrl && ((lastImgEl && lastImgEl.src.includes(m.mediaUrl)) || (lastAudioEl && lastAudioEl.src.includes(m.mediaUrl))));

    if (isLastAdmin === (m.sender === 'admin') && isSameText && isSameMedia) {
      const timeEl = lastBubble.querySelector('.message-time');
      if (timeEl) timeEl.innerHTML = `${formatTimeOnly(m.createdAt || new Date())} ${m.sender === 'admin' ? '✓✓' : ''}`;
      return;
    }
  }

  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const isAdmin = m.sender === 'admin';
  const timeFormatted = formatTimeOnly(m.createdAt || new Date());

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = `message-bubble ${isAdmin ? 'bubble-admin' : 'bubble-user'}`;
  bubbleDiv.innerHTML = `
    <div class="bubble-sender">${isAdmin ? '🛡️ You (via Bot)' : `👤 ${escapeHtml(m.userName || 'Customer')}`}</div>
    ${renderBubbleContent(m)}
    <div class="message-time">${timeFormatted} ${isAdmin ? '✓✓' : ''}</div>
  `;

  container.appendChild(bubbleDiv);
  container.scrollTop = container.scrollHeight;
}

// ─── Conversation Management ──────────────────────────────────────────────────
async function loadConversations(isSilent = false) {
  const container = document.getElementById('conversationList');
  try {
    const url = currentChannelTag 
      ? `/api/chat/conversations?channel=${encodeURIComponent(currentChannelTag)}`
      : '/api/chat/conversations';

    const res = await fetch(url);
    const json = await res.json();
    if (json.success) {
      allConversations = json.data || [];
      if (container) renderConversationsList(allConversations);

      // Auto-select first conversation on desktop if none selected
      if (container && !activeChatUserId && allConversations.length > 0 && window.innerWidth > 768 && !isSilent) {
        selectConversation(allConversations[0].convId || allConversations[0].userId);
      }
    }
  } catch (err) {
    if (!isSilent) console.error('Error loading conversations:', err);
  }
}

function renderConversationsList(convs) {
  const container = document.getElementById('conversationList');
  if (!container) return;

  const query = (document.getElementById('chatSearchInput')?.value || '').toLowerCase().trim();

  let filtered = convs;
  if (query) {
    filtered = convs.filter(c => 
      (c.userName && c.userName.toLowerCase().includes(query)) ||
      (c.userUsername && c.userUsername.toLowerCase().includes(query)) ||
      String(c.userId).includes(query) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
    );
  }

  const currentKey = filtered.map(c => (c.convId || c.userId) + (c.lastMessageTime || '') + (c.unreadCount || 0) + (String(c.convId || c.userId) === String(activeChatUserId) ? '_a' : '')).join('|');
  if (currentKey && currentKey === lastRenderedConvsKey && container.children.length > 0) {
    return;
  }
  lastRenderedConvsKey = currentKey;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8">
        <p class="text-muted">${query ? 'No matching customer found' : 'No chats yet for this channel. Incoming customer messages will appear here!'}</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const c of filtered) {
    const key = c.convId || c.userId;
    const isActive = activeChatUserId && String(activeChatUserId) === String(key);
    const initial = (c.userName ? c.userName.charAt(0) : 'U').toUpperCase();
    const timeFormatted = formatChatTime(c.lastMessageTime);
    const unread = isActive ? 0 : (c.unreadCount || 0);
    const isUnreadClass = unread > 0 ? 'unread' : '';

    html += `
      <div class="chat-contact-item ${isActive ? 'active' : ''}" onclick="selectConversation('${key}')">
        <div class="contact-avatar">${escapeHtml(initial)}</div>
        <div class="contact-info">
          <div class="contact-top">
            <span class="contact-name">${escapeHtml(c.userName || 'Customer')}</span>
            <span class="contact-time">${timeFormatted}</span>
          </div>
          <div class="contact-bottom">
            <span class="contact-preview ${isUnreadClass}">
              ${c.lastMessageSender === 'admin' ? '<span style="color:var(--accent-cyan);">You: </span>' : ''}${escapeHtml(c.lastMessage || 'Started bot')}
            </span>
            ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

window.selectConversation = async function(convKey) {
  const targetKey = String(convKey);
  activeChatUserId = targetKey;
  lastRenderedMessagesKey = '';
  const conv = allConversations.find(c => String(c.convId || c.userId) === targetKey);

  if (conv) {
    conv.unreadCount = 0;
  }

  renderConversationsList(allConversations);

  const emptyState = document.getElementById('chatEmptyState');
  const chatWindow = document.getElementById('chatWindow');

  if (emptyState) emptyState.style.display = 'none';
  if (chatWindow) chatWindow.style.display = 'flex';

  document.querySelector('.whatsapp-container')?.classList.add('mobile-chat-active');

  const avatarEl = document.getElementById('activeUserAvatar');
  const nameEl = document.getElementById('activeUserName');
  const handleEl = document.getElementById('activeUserHandle');
  const tagEl = document.getElementById('activeUserTag');
  const idEl = document.getElementById('activeUserId');
  const tgLinkEl = document.getElementById('btnOpenTgProfile');

  const rawUserId = targetKey.includes('_') ? targetKey.split('_')[0] : targetKey;

  if (conv) {
    if (avatarEl) avatarEl.textContent = (conv.userName ? conv.userName.charAt(0) : 'U').toUpperCase();
    if (nameEl) nameEl.textContent = conv.userName || `User ${rawUserId}`;
    if (handleEl) handleEl.textContent = conv.userUsername ? `@${conv.userUsername}` : 'No username';
    if (tagEl) tagEl.textContent = conv.channelName || conv.channelTag || 'Direct Support';
    if (idEl) idEl.textContent = `ID: ${rawUserId}`;

    if (tgLinkEl) {
      if (conv.userUsername) {
        tgLinkEl.href = `https://t.me/${conv.userUsername}`;
        tgLinkEl.style.display = 'inline-flex';
      } else {
        tgLinkEl.style.display = 'none';
      }
    }
  } else {
    if (idEl) idEl.textContent = `ID: ${rawUserId}`;
  }

  // Clear previous chat immediately and show loading spinner
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center">
        <div class="loading-spinner" style="width:22px; height:22px; margin:0 auto;"></div>
        <p class="text-muted mt-2">Loading messages...</p>
      </div>
    `;
  }

  await loadMessages(targetKey);

  const input = document.getElementById('chatMessageInput');
  if (input && window.innerWidth > 768) input.focus();
};

// ─── Messages Management ──────────────────────────────────────────────────────
async function loadMessages(convKey) {
  if (!convKey || activeChatUserId !== convKey) return;
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  try {
    const res = await fetch(`/api/chat/messages/${encodeURIComponent(convKey)}`);
    const json = await res.json();
    
    // Discard response if user already switched to another contact
    if (activeChatUserId !== convKey) return;

    if (json.success) {
      const messages = json.data || [];
      
      const newKey = messages.map(m => (m._id || m.id || '') + (m.text || '')).join('|');
      if (newKey && newKey === lastRenderedMessagesKey && container.children.length > 0 && !container.querySelector('.loading-spinner')) return;
      lastRenderedMessagesKey = newKey;

      if (messages.length === 0) {
        container.innerHTML = `
          <div class="empty-state py-8 text-center">
            <p class="text-muted">No messages in this chat yet. Type below to send a message!</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const m of messages) {
        const isAdmin = m.sender === 'admin';
        const timeFormatted = formatTimeOnly(m.createdAt);

        html += `
          <div class="message-bubble ${isAdmin ? 'bubble-admin' : 'bubble-user'}">
            <div class="bubble-sender">${isAdmin ? '🛡️ You (via Bot)' : `👤 ${escapeHtml(m.userName || 'Customer')}`}</div>
            ${renderBubbleContent(m)}
            <div class="message-time">${timeFormatted} ${isAdmin ? '✓✓' : ''}</div>
          </div>
        `;
      }

      container.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

// Media state for image attachments & voice recordings in client view
let pendingAttachment = null;
let mediaRecorder = null;
let recordedAudioChunks = [];
let voiceRecordInterval = null;
let voiceRecordSeconds = 0;

function compressImage(file, maxDimension = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, name: file.name.replace(/\.[^/.]+$/, '') + '.jpg', type: 'image' });
      };
      img.onerror = () => resolve({ dataUrl: e.target.result, name: file.name, type: 'image' });
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function initChatMediaControls() {
  const btnAttach = document.getElementById('btnAttachImage');
  const fileInput = document.getElementById('chatFileInput');
  const previewBox = document.getElementById('chatAttachmentPreview');
  const previewImg = document.getElementById('previewThumbImg');
  const previewName = document.getElementById('previewFileName');
  const btnCancelPreview = document.getElementById('btnCancelAttachment');

  const btnVoice = document.getElementById('btnVoiceRecord');
  const voiceBar = document.getElementById('voiceRecordBar');
  const voiceTimer = document.getElementById('voiceRecordTimer');
  const btnCancelVoice = document.getElementById('btnCancelVoice');
  const btnSendVoice = document.getElementById('btnSendVoice');

  // 1. Image Attachment with Fast Compression
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const compressed = await compressImage(file);
      if (!compressed) return;

      pendingAttachment = compressed;
      if (previewImg) previewImg.src = compressed.dataUrl;
      if (previewName) previewName.textContent = compressed.name;
      if (previewBox) previewBox.style.display = 'flex';
      document.getElementById('chatMessageInput')?.focus();
    });
  }

  if (btnCancelPreview) {
    btnCancelPreview.addEventListener('click', () => {
      pendingAttachment = null;
      if (fileInput) fileInput.value = '';
      if (previewBox) previewBox.style.display = 'none';
    });
  }

  // 2. Voice Recorder
  if (btnVoice) {
    btnVoice.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopVoiceRecording(false);
        return;
      }
      startVoiceRecording();
    });
  }

  if (btnCancelVoice) {
    btnCancelVoice.addEventListener('click', () => {
      stopVoiceRecording(true);
    });
  }

  if (btnSendVoice) {
    btnSendVoice.addEventListener('click', () => {
      stopVoiceRecording(false, true);
    });
  }

  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedAudioChunks = [];
      
      let options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) options = { mimeType: 'audio/mp4' };
        else if (MediaRecorder.isTypeSupported('audio/ogg')) options = { mimeType: 'audio/ogg' };
        else options = {};
      }

      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedAudioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(voiceRecordInterval);
        if (voiceBar) voiceBar.style.display = 'none';
        if (btnVoice) btnVoice.classList.remove('recording');

        if (mediaRecorder._shouldSend && recordedAudioChunks.length > 0) {
          const audioBlob = new Blob(recordedAudioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          const reader = new FileReader();
          reader.onload = async (e) => {
            const dataUrl = e.target.result;
            await uploadAndSendMedia(dataUrl, 'voice', 'voice_note.webm');
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      mediaRecorder.start(100);
      voiceRecordSeconds = 0;
      if (voiceTimer) voiceTimer.textContent = '0:00';
      if (voiceBar) voiceBar.style.display = 'flex';
      if (btnVoice) btnVoice.classList.add('recording');

      voiceRecordInterval = setInterval(() => {
        voiceRecordSeconds++;
        const mins = Math.floor(voiceRecordSeconds / 60);
        const secs = voiceRecordSeconds % 60;
        if (voiceTimer) voiceTimer.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }, 1000);
    } catch (err) {
      alert('⚠️ Microphone Access Required:\nPlease allow microphone permission in your browser to record voice notes.');
    }
  }

  function stopVoiceRecording(cancel = false, send = false) {
    if (!mediaRecorder) return;
    mediaRecorder._shouldSend = send && !cancel;
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }
}

async function uploadAndSendMedia(dataUrl, mediaType, filename = 'attachment') {
  if (!activeChatUserId) {
    alert('Please select a customer chat first.');
    return;
  }

  try {
    const uploadRes = await fetch('/api/chat/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, mediaType, filename })
    });
    const uploadJson = await uploadRes.json();
    if (!uploadJson.success || !uploadJson.url) {
      alert('Failed to upload media: ' + (uploadJson.error || 'Unknown error'));
      return;
    }

    const mediaUrl = uploadJson.url;
    const rawUserId = activeChatUserId.includes('_') ? activeChatUserId.split('_')[0] : activeChatUserId;

    // Instant local echo
    appendMessageBubbleDirectly({
      userId: rawUserId,
      sender: 'admin',
      userName: 'You',
      text: '',
      type: mediaType,
      mediaUrl: mediaUrl,
      mediaType: mediaType,
      createdAt: new Date().toISOString()
    });

    const sendRes = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: activeChatUserId,
        text: '',
        mediaUrl: mediaUrl,
        mediaType: mediaType
      })
    });

    const sendJson = await sendRes.json();
    if (sendJson.success) {
      await loadActiveChatMessages(activeChatUserId);
      loadConversations(true);
    } else {
      alert('Failed to send media via Bot: ' + (sendJson.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Network error sending media: ' + err.message);
  }
}

window.openImageLightbox = function(src) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImg');
  if (modal && img) {
    img.src = src;
    modal.style.display = 'flex';
  }
};

window.closeImageLightbox = function() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.style.display = 'none';
};

// ─── Sending Messages ─────────────────────────────────────────────────────────
async function sendChatMessage() {
  if (!activeChatUserId) return;

  const input = document.getElementById('chatMessageInput');
  const btn = document.getElementById('btnSendMessage');
  const text = input ? input.value.trim() : '';

  if (!text && !pendingAttachment) return;

  const rawUserId = activeChatUserId.includes('_') ? activeChatUserId.split('_')[0] : activeChatUserId;

  let attachedMediaUrl = '';
  let attachedMediaType = 'text';

  if (pendingAttachment) {
    try {
      const uploadRes = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: pendingAttachment.dataUrl,
          mediaType: 'image',
          filename: pendingAttachment.name
        })
      });
      const uploadJson = await uploadRes.json();
      if (uploadJson.success && uploadJson.url) {
        attachedMediaUrl = uploadJson.url;
        attachedMediaType = 'image';
      }
    } catch (e) {}

    pendingAttachment = null;
    const fileInput = document.getElementById('chatFileInput');
    const previewBox = document.getElementById('chatAttachmentPreview');
    if (fileInput) fileInput.value = '';
    if (previewBox) previewBox.style.display = 'none';
  }

  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  if (btn) btn.disabled = true;

  // Instant local echo in 0ms
  appendMessageBubbleDirectly({
    userId: rawUserId,
    sender: 'admin',
    userName: 'You',
    text: text,
    createdAt: new Date().toISOString()
  });

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeChatUserId, text })
    });

    const json = await res.json();
    if (!json.success) {
      alert(`⚠️ Failed to deliver message: ${json.error || 'Unknown error'}`);
    } else {
      loadConversations(true);
    }
  } catch (err) {
    console.error('Error sending message:', err);
    alert('⚠️ Network error while sending message. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function initChatEventListeners() {
  const btnSend = document.getElementById('btnSendMessage');
  if (btnSend) {
    btnSend.addEventListener('click', sendChatMessage);
  }

  const input = document.getElementById('chatMessageInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // Auto-expand textarea height as user types or shifts down with Shift+Enter
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
  }

  const searchInput = document.getElementById('chatSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderConversationsList(allConversations);
    });
  }

  const btnBack = document.getElementById('btnBackToSidebar');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      document.querySelector('.whatsapp-container')?.classList.remove('mobile-chat-active');
      activeChatUserId = null;
      renderConversationsList(allConversations);
    });
  }
}

// ─── Notifications & Audio Chime ──────────────────────────────────────────────
function initNotificationToggle() {
  const btn = document.getElementById('btnToggleNotification');
  if (!btn) return;

  function updateButtonState() {
    if (!('Notification' in window)) {
      btn.innerHTML = '🔔 Notifications (Unsupported)';
      btn.disabled = true;
      return;
    }

    if (Notification.permission === 'granted') {
      btn.innerHTML = '<span style="color:#10b981;">●</span> 🔔 Notifications Active';
      btn.classList.add('active');
    } else {
      btn.innerHTML = '🔔 Enable Notifications';
      btn.classList.remove('active');
    }
  }

  updateButtonState();

  btn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      alert('Browser notifications are not supported on this browser. On iPhone, please use Safari and Add to Home Screen.');
      return;
    }

    if (Notification.permission === 'granted') {
      playNotificationChime();
      showSystemNotification('Live Chat Notifications Active!', '✅ Real-time notifications are enabled for this support portal.');
      alert('🔔 Notifications are ACTIVE!\nA test notification has been sent.');
    } else {
      const permission = await Notification.requestPermission();
      updateButtonState();
      if (permission === 'granted') {
        playNotificationChime();
        showSystemNotification('Notifications Enabled!', '🎉 You will now receive instant popups when customers message!');
      } else {
        alert('⚠️ Notification permission was blocked. Please enable notifications in your browser settings.');
      }
    }
  });
}

function showSystemNotification(title, body, userId = null) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const options = {
      body: body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: userId ? `user-${userId}` : 'teletrack-msg',
      renotify: true,
      vibrate: [200, 100, 200]
    };

    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      if (userId) selectConversation(userId);
      notif.close();
    };
  } catch (e) {
    console.warn('System notification failed:', e);
  }
}

function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Pleasant 2-tone chime
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.1); // A5

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now);
    osc2.frequency.setValueAtTime(1174.66, now + 0.1); // D6

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  } catch (e) {}
}

// ─── PWA Installation ─────────────────────────────────────────────────────────
function initPwaInstaller() {
  const btn = document.getElementById('btnInstallApp');
  if (!btn) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.style.display = 'inline-flex';
  });

  btn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        btn.style.display = 'none';
      }
      deferredInstallPrompt = null;
    } else {
      alert('📲 To install on iPhone/iPad:\n1. Tap the Share button in Safari (box with arrow)\n2. Tap "Add to Home Screen" ➕\n\nOn Android/Desktop:\nLook for "Install" or "Add to Home Screen" in your browser menu.');
    }
  });
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────
function formatChatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Client Authentication Guard ──────────────────────────────────────────────
function isClientAuthenticated() {
  const adminToken = localStorage.getItem('teletrack_admin_auth');
  if (adminToken) return true;
  const clientToken = localStorage.getItem(`teletrack_client_auth_${currentChannelTag || 'default'}`);
  return !!clientToken;
}

async function checkClientAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const pinFromUrl = urlParams.get('pin');

  // Auto-login via URL PIN if present
  if (pinFromUrl) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pinFromUrl, role: 'client', channelTag: currentChannelTag })
      });
      const json = await res.json();
      if (json.success) {
        localStorage.setItem(`teletrack_client_auth_${currentChannelTag || 'default'}`, json.token || '1');
        addClientLogoutButton();
        return true;
      }
    } catch (e) {}
  }

  if (isClientAuthenticated()) {
    addClientLogoutButton();
    return true;
  }

  // Render Client Lock Overlay
  const brandName = channelInfo?.name || `Support (${currentChannelTag || 'Channel'})`;
  let overlay = document.getElementById('clientAuthOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'clientAuthOverlay';
    overlay.className = 'auth-lock-overlay';
    overlay.innerHTML = `
      <div class="auth-lock-card">
        <div class="auth-lock-icon">🔒</div>
        <h2 class="auth-lock-title">${escapeHtml(brandName)}</h2>
        <p class="auth-lock-desc">Enter your 4-digit PIN or Password to access customer live chat.</p>
        <form id="clientAuthForm">
          <div class="auth-input-wrap">
            <input type="password" id="clientPinInput" class="auth-input" placeholder="Enter Access PIN..." required autocomplete="current-password" />
            <div class="auth-error-text" id="clientAuthError"></div>
          </div>
          <button type="submit" class="btn-auth-submit" id="btnClientLogin">
            🔓 Unlock Live Chat
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('clientAuthForm');
    const input = document.getElementById('clientPinInput');
    const errorEl = document.getElementById('clientAuthError');
    const btn = document.getElementById('btnClientLogin');

    if (input) setTimeout(() => input.focus(), 150);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = input.value.trim();
      if (!pass) return;

      btn.disabled = true;
      btn.textContent = 'Verifying PIN...';
      errorEl.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, role: 'client', channelTag: currentChannelTag })
        });
        const json = await res.json();
        if (json.success) {
          localStorage.setItem(`teletrack_client_auth_${currentChannelTag || 'default'}`, json.token || '1');
          overlay.remove();
          addClientLogoutButton();
          initSSE();
          loadConversations();
        } else {
          errorEl.textContent = '❌ ' + (json.error || 'Incorrect PIN / Password');
          errorEl.style.display = 'block';
          input.value = '';
          input.focus();
        }
      } catch (err) {
        errorEl.textContent = '⚠️ Network error: ' + err.message;
        errorEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = '🔓 Unlock Live Chat';
      }
    });
  }

  return false;
}

function addClientLogoutButton() {
  const actions = document.querySelector('.client-navbar .nav-actions') || document.querySelector('.nav-actions');
  if (!actions || document.getElementById('btnClientLogout')) return;

  const btn = document.createElement('button');
  btn.id = 'btnClientLogout';
  btn.className = 'btn btn-sm btn-auth-logout';
  btn.innerHTML = '🔒 Lock';
  btn.title = 'Lock Chat Session';
  btn.onclick = () => {
    if (confirm('Lock Live Chat session?')) {
      localStorage.removeItem(`teletrack_client_auth_${currentChannelTag || 'default'}`);
      window.location.reload();
    }
  };
  actions.appendChild(btn);
}
