// TeleTrack CAPI & Live Chat Frontend Controller
let allChannels = [];
let botUsername = 'southboookbot';
let activeChatUserId = null;
let allConversations = [];
let deferredInstallPrompt = null;
let lastKnownMessageCount = 0;
let lastRenderedMessagesKey = '';
let lastRenderedConvsKey = '';

document.addEventListener('DOMContentLoaded', () => {
  highlightCurrentNav();
  initPwaInstaller();
  initNotificationToggle();
  initSSE();
  initChatEventListeners();
  initChatMediaControls();
  initEventListeners();
  initChannelModalListeners();

  const isAuth = checkAdminAuth();
  if (isAuth) {
    initPageData();
  }
});

function initPageData() {
  const path = window.location.pathname;
  const pageAttr = document.body.getAttribute('data-page');
  loadAppConfig();

  if (path === '/channel-analytics' || path === '/channels-analytics' || pageAttr === 'channel_analytics') {
    Promise.all([loadChannelAnalytics(), loadChannels(), loadChannelAnalyticsLeads()]);
  } else if (path === '/channels') {
    loadChannels();
  } else if (path === '/links') {
    loadChannels();
  } else if (path === '/leads' || pageAttr === 'leads') {
    Promise.all([loadStats(), loadChannels(), loadLeads()]);
  } else {
    // /chat or default index
    Promise.all([loadChannels(), loadConversations(), loadStats()]);
  }
}

// Real-Time Server-Sent Events (SSE) Socket Stream (0ms Instant Sync)
function initSSE() {
  if (!('EventSource' in window)) return;
  try {
    const es = new EventSource('/api/chat/events');

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'new_message' && payload.message) {
          const msg = payload.message;
          const openUserId = activeChatUserId ? String(activeChatUserId).split('_')[0] : '';
          const incomingUserId = String(msg.userId || msg.userChatId || '');

          // If message is in active open chat room, render instantly (0ms)
          if (openUserId && openUserId === incomingUserId) {
            appendMessageBubbleDirectly(msg);
            loadActiveChatMessages(activeChatUserId, true);
          } else if (!activeChatUserId && window.innerWidth > 768 && document.getElementById('chatMessagesContainer')) {
            selectConversation(`${msg.userId}_${msg.channelTag || 'default'}`);
          }

          // Sound & OS Notification for customer messages
          if (msg.sender === 'user') {
            playNotificationChime();
            showSystemNotification(`New Message from ${msg.userName || 'Customer'}`, msg.text || '[Media]', msg.userId);
          }

          // Refresh conversation sidebar badge & last message instantly if on chat page
          if (document.getElementById('conversationList')) {
            loadConversations(true);
          }
        } else if (payload.type === 'new_lead') {
          if (document.getElementById('kpiTodayLeads')) loadStats();
          if (document.getElementById('leadsTableBody')) loadLeads();
          if (document.getElementById('conversationList')) loadConversations(true);
        }
      } catch (err) {}
    };

    es.onerror = () => {
      // Auto reconnects
    };
  } catch (err) {
    console.warn('SSE connection notice:', err);
  }

  // Active chat real-time sync heartbeat (1.5s interval) - ONLY on active chat page
  setInterval(() => {
    if (localStorage.getItem('teletrack_admin_auth') && document.getElementById('chatMessagesContainer')) {
      if (activeChatUserId) {
        loadActiveChatMessages(activeChatUserId, true);
      }
      loadConversations(true);
    }
  }, 1500);
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

  // Remove empty state if present
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

// Notification Toggle & Permission Handler
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
      // Send a test notification
      playNotificationChime();
      showSystemNotification('TeleTrack Notifications Active!', '✅ Real-time notifications are enabled for iOS, Android & Desktop.');
      alert('🔔 Notifications are ACTIVE!\nA test notification has been sent.');
    } else {
      const permission = await Notification.requestPermission();
      updateButtonState();
      if (permission === 'granted') {
        playNotificationChime();
        showSystemNotification('Notifications Enabled!', '🎉 You will now receive instant popups when customers message your bot!');
      } else {
        alert('⚠️ Notification permission was blocked or denied. Please enable notifications in your browser/device settings.');
      }
    }
  });
}

// Show System / OS Notification Banner
function showSystemNotification(title, body, userId = null) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, {
          body: body,
          icon: '/icon.svg',
          badge: '/icon.svg',
          vibrate: [200, 100, 200],
          data: { url: '/chat', userId: userId }
        });
      });
    } else {
      new Notification(title, {
        body: body,
        icon: '/icon.svg',
        data: { url: '/chat' }
      });
    }
  } catch (err) {
    console.warn('Notification display error:', err);
  }
}

// Highlight active top nav and sidebar buttons based on URL
function highlightCurrentNav() {
  const path = window.location.pathname;
  const links = document.querySelectorAll('.nav-link-btn, .sidebar-nav-item');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === path || (path === '/' && href === '/chat')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// PWA Installer - Direct Native Trigger
function initPwaInstaller() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const btnInstall = document.getElementById('btnInstallApp');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstall) {
      btnInstall.innerHTML = '<span>⬇️</span> Install App';
      btnInstall.style.background = 'linear-gradient(135deg, var(--accent-cyan), var(--accent-primary))';
      btnInstall.style.color = '#ffffff';
      btnInstall.style.borderColor = 'transparent';
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btnInstall) {
      btnInstall.innerHTML = '<span>✅</span> Installed';
      btnInstall.style.background = 'transparent';
      btnInstall.style.color = 'var(--accent-emerald)';
    }
    deferredInstallPrompt = null;
  });

  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        // 1. Direct native browser install dialog
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          btnInstall.innerHTML = '<span>✅</span> Installed';
        }
        deferredInstallPrompt = null;
      } else {
        // 2. Direct simple prompt for devices
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
          alert('📱 iPhone / iPad:\nNeeche Safari Share button [⬆️] dabayein aur "Add to Home Screen" [➕] par tap karein!');
        } else {
          alert('💻 Desktop / Android:\nAddress bar me [ ⊤ Open in app ] ya [ ⬇️ Install ] icon par click karein!');
        }
      }
    });
  }
}

window.openPwaModal = function() {};
window.closePwaModal = function() {
  document.getElementById('pwaGuideModal')?.classList.remove('active');
};

// Event Listeners (Safe for all pages)
function initEventListeners() {
  document.getElementById('btnRefresh')?.addEventListener('click', () => {
    loadStats();
    loadChannels();
    loadLeads();
    loadConversations();
    if (activeChatUserId) loadActiveChatMessages(activeChatUserId);
  });

  document.getElementById('searchLeads')?.addEventListener('input', () => {
    loadLeads();
  });

  document.getElementById('channelFilter')?.addEventListener('change', () => {
    loadLeads();
  });

  document.getElementById('btnTestLead')?.addEventListener('click', handleSendTestLead);

  // Mobile Drawer Toggle
  const hamburger = document.getElementById('btnHamburgerMenu');
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('drawer-open');
      backdrop?.classList.toggle('active');
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('drawer-open');
      backdrop.classList.remove('active');
    });
  }
}

// Channel Modal Listeners
function initChannelModalListeners() {
  const modal = document.getElementById('channelModal');
  const btnOpen = document.getElementById('btnOpenAddChannelModal');
  const btnClose = document.getElementById('btnCloseModal');
  const btnCancel = document.getElementById('btnCancelModal');
  const form = document.getElementById('channelForm');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => openChannelModal());
  }
  if (btnClose && modal) {
    btnClose.addEventListener('click', () => modal.classList.remove('active'));
  }
  if (btnCancel && modal) {
    btnCancel.addEventListener('click', () => modal.classList.remove('active'));
  }
  if (form) {
    form.addEventListener('submit', handleSaveChannel);
  }
}

// Config Loader
async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    const json = await res.json();
    if (json.success && json.botUsername) {
      botUsername = json.botUsername;
      // Re-render links if already loaded
      if (allChannels.length > 0) renderAdLinks(allChannels);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

// ============================================================
// 💬 LIVE CHAT LOGIC
// ============================================================

function initChatEventListeners() {
  const sendBtn = document.getElementById('btnSendMessage');
  const input = document.getElementById('chatMessageInput');
  const searchInput = document.getElementById('chatSearchInput');
  const backBtn = document.getElementById('btnBackToSidebar');

  if (sendBtn && input) {
    sendBtn.addEventListener('click', sendChatMessage);
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

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderConversationsList(allConversations);
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.querySelector('.whatsapp-container')?.classList.remove('mobile-chat-active');
    });
  }
}

async function loadConversations(isSilent = false) {
  const container = document.getElementById('conversationList');
  try {
    const res = await fetch('/api/chat/conversations');
    const json = await res.json();
    if (json.success) {
      allConversations = json.data || [];
      if (container) renderConversationsList(allConversations);

      let totalUnread = 0;
      for (const c of allConversations) {
        totalUnread += (c.unreadCount || 0);
      }

      const badge = document.getElementById('topUnreadBadge');
      if (badge) badge.textContent = totalUnread;

      const kpiChats = document.getElementById('kpiActiveChats');
      if (kpiChats) kpiChats.textContent = allConversations.length;

      // Auto-select pending or first conversation on desktop if none selected
      const pendingConv = sessionStorage.getItem('pendingChatConv');
      if (pendingConv) {
        sessionStorage.removeItem('pendingChatConv');
        selectConversation(pendingConv);
      } else if (container && !activeChatUserId && allConversations.length > 0 && window.innerWidth > 768 && !isSilent) {
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
      (c.channelName && c.channelName.toLowerCase().includes(query)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
    );
  }

  const currentKey = filtered.map(c => (c.convId || c.userId) + (c.lastMessageTime || '') + (c.unreadCount || 0) + (String(c.convId || c.userId) === String(activeChatUserId) ? '_a' : '')).join('|');
  if (currentKey && currentKey === lastRenderedConvsKey && container.children.length > 0) {
    return; // Exact same conversation list, skip re-render to prevent blinking
  }
  lastRenderedConvsKey = currentKey;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8">
        <p class="text-muted">${query ? 'No matching customer found' : 'No chats yet. When users message the bot, they appear here!'}</p>
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
    const botName = c.channelName || (c.botUsername ? `@${c.botUsername}` : c.channelTag) || 'Bot';

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
            <span class="bot-badge-pill" title="Bot: ${escapeHtml(botName)}">🤖 ${escapeHtml(botName)}</span>
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

  // Mark read in DB in background
  fetch(`/api/chat/read/${encodeURIComponent(targetKey)}`, { method: 'POST' }).catch(() => {});

  const emptyState = document.getElementById('chatEmptyState');
  if (emptyState) emptyState.style.display = 'none';

  const chatWindow = document.getElementById('chatWindow');
  if (chatWindow) chatWindow.style.display = 'flex';

  document.querySelector('.whatsapp-container')?.classList.add('mobile-chat-active');

  if (conv) {
    const avatar = document.getElementById('activeUserAvatar');
    if (avatar) avatar.textContent = (conv.userName ? conv.userName.charAt(0) : 'U').toUpperCase();

    const nameEl = document.getElementById('activeUserName');
    if (nameEl) nameEl.textContent = conv.userName || 'Customer';

    const handleEl = document.getElementById('activeUserHandle');
    if (handleEl) handleEl.textContent = conv.userUsername ? `@${conv.userUsername}` : 'No username';

    const tagEl = document.getElementById('activeUserTag');
    if (tagEl) tagEl.textContent = `🤖 ${conv.channelName || (conv.botUsername ? `@${conv.botUsername}` : conv.channelTag)}`;

    const idEl = document.getElementById('activeUserId');
    if (idEl) idEl.textContent = `ID: ${conv.userId}`;

    const tgBtn = document.getElementById('btnOpenTgProfile');
    if (tgBtn) {
      if (conv.userUsername) {
        tgBtn.href = `https://t.me/${conv.userUsername}`;
        tgBtn.style.display = 'inline-flex';
      } else {
        tgBtn.style.display = 'none';
      }
    }
  }

  // Immediately clear old chat and show loading spinner
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center">
        <div class="loading-spinner" style="width:22px; height:22px; margin:0 auto;"></div>
        <p class="text-muted mt-2">Loading messages...</p>
      </div>
    `;
  }

  renderConversationsList(allConversations);
  await loadActiveChatMessages(targetKey);

  document.getElementById('chatMessageInput')?.focus();
};

async function loadActiveChatMessages(userId, isSilent = false) {
  if (!userId || activeChatUserId !== userId) return;
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  try {
    const res = await fetch(`/api/chat/messages/${encodeURIComponent(userId)}`);
    const json = await res.json();
    
    // Discard response if user already switched to another contact
    if (activeChatUserId !== userId) return;

    if (json.success) {
      const messages = json.data || [];
      
      if (isSilent && messages.length > lastKnownMessageCount) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.sender === 'user') {
          playNotificationChime();
          showSystemNotification(`New Message from ${lastMsg.userName || 'Customer'}`, lastMsg.text || '[Media]', userId);
        }
      }
      lastKnownMessageCount = messages.length;

      renderMessagesStream(messages);
    }
  } catch (err) {
    if (!isSilent) console.error('Error loading chat messages:', err);
  }
}

function renderMessagesStream(messages) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  const currentKey = messages.map(m => (m._id || m.id || '') + (m.createdAt || '') + (m.text || '') + (m.mediaUrl || '')).join('|');
  if (currentKey && currentKey === lastRenderedMessagesKey && container.children.length > 0) {
    return; // Exact same messages, skip re-render to prevent blinking
  }
  lastRenderedMessagesKey = currentKey;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center">
        <p class="text-muted">No messages yet. Type below to send a message to this customer via the Bot!</p>
      </div>
    `;
    return;
  }

  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

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

  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

// Media state for image attachments & voice recordings
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

  // 1. Image Attachment with Instant WhatsApp-style Compression
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

    // Instant local echo
    appendMessageBubbleDirectly({
      userId: activeChatUserId,
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
      await loadActiveChatMessages(activeChatUserId, true);
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

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  if (!input) return;
  const text = input.value.trim();

  if (!text && !pendingAttachment) return;

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

  input.value = '';
  input.style.height = 'auto';

  // Instant local echo
  appendMessageBubbleDirectly({
    userId: activeChatUserId,
    sender: 'admin',
    userName: 'You',
    text: text,
    type: attachedMediaType,
    mediaUrl: attachedMediaUrl,
    mediaType: attachedMediaType,
    createdAt: new Date().toISOString()
  });

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: activeChatUserId,
        text: text,
        mediaUrl: attachedMediaUrl,
        mediaType: attachedMediaType
      })
    });

    const json = await res.json();
    if (json.success) {
      lastRenderedMessagesKey = '';
      await loadActiveChatMessages(activeChatUserId, true);
      loadConversations(true);
    } else {
      alert('Failed to deliver message: ' + (json.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Network error sending message: ' + err.message);
  }
}

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

function formatChatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Date Range Filtering Engine ─────────────────────────────────────────────
window.currentDateRange = 'all';
window.currentStartDate = '';
window.currentEndDate = '';

window.selectDateRange = function(range) {
  window.currentDateRange = range;
  window.currentStartDate = '';
  window.currentEndDate = '';

  const startInp = document.getElementById('customStartDate');
  const endInp = document.getElementById('customEndDate');
  if (startInp) startInp.value = '';
  if (endInp) endInp.value = '';

  const labels = {
    all: 'All Time',
    today: 'Today',
    yesterday: 'Yesterday',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days'
  };

  const activeLabelEl = document.getElementById('activeDateRangeLabel');
  if (activeLabelEl) activeLabelEl.textContent = labels[range] || range;

  const pillIds = ['pillRangeAll', 'pillRangeToday', 'pillRangeYesterday', 'pillRange7d', 'pillRange30d'];
  pillIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if ((range === 'all' && id === 'pillRangeAll') ||
          (range === 'today' && id === 'pillRangeToday') ||
          (range === 'yesterday' && id === 'pillRangeYesterday') ||
          (range === '7d' && id === 'pillRange7d') ||
          (range === '30d' && id === 'pillRange30d')) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });

  loadStats();
  loadLeads();
};

window.applyCustomDateRange = function() {
  const startVal = document.getElementById('customStartDate')?.value;
  const endVal = document.getElementById('customEndDate')?.value;

  if (startVal || endVal) {
    window.currentDateRange = 'custom';
    window.currentStartDate = startVal || '';
    window.currentEndDate = endVal || '';

    const pillIds = ['pillRangeAll', 'pillRangeToday', 'pillRangeYesterday', 'pillRange7d', 'pillRange30d'];
    pillIds.forEach(id => document.getElementById(id)?.classList.remove('active'));

    const activeLabelEl = document.getElementById('activeDateRangeLabel');
    if (activeLabelEl) {
      activeLabelEl.textContent = `${startVal || '...'} to ${endVal || '...'}`;
    }

    loadStats();
    loadLeads();
  }
};

async function loadStats() {
  try {
    const range = window.currentDateRange || 'all';
    const sDate = window.currentStartDate || '';
    const eDate = window.currentEndDate || '';
    const res = await fetch(`/api/stats?range=${encodeURIComponent(range)}&startDate=${encodeURIComponent(sDate)}&endDate=${encodeURIComponent(eDate)}`);
    const json = await res.json();
    if (json.success) {
      const stats = json.data;

      // 1. Today's Bot Starts
      const todayVal = stats.todayLeads || 0;
      const todayEl = document.getElementById('todayLeadsCount') || document.getElementById('kpiTodayLeads');
      if (todayEl) todayEl.textContent = todayVal;

      // 2. Active Conversations
      const activeChatsEl = document.getElementById('activeChatsCount') || document.getElementById('kpiActiveChats');
      if (activeChatsEl) {
        activeChatsEl.textContent = stats.activeChats !== undefined ? stats.activeChats : 0;
      }

      // 3. Total Bot Leads
      const botLeadsVal = stats.botLeads !== undefined ? stats.botLeads : (stats.totalLeads || 0);
      const totalEl = document.getElementById('totalLeadsCount') || document.getElementById('kpiTotalLeads');
      if (totalEl) totalEl.textContent = botLeadsVal;

      // 4. Meta CAPI Sync Rate
      const succ = stats.successfulCapi || 0;
      const fail = stats.failedCapi || 0;
      const totalSync = succ + fail;
      const rate = totalSync > 0 ? Math.round((succ / totalSync) * 100) : 100;

      const syncRateEl = document.getElementById('syncRateValue') || document.getElementById('kpiSyncRate');
      if (syncRateEl) syncRateEl.textContent = `${rate}%`;

      const syncSubtextEl = document.getElementById('capiStatsSubtext') || document.getElementById('kpiSyncCount');
      if (syncSubtextEl) syncSubtextEl.textContent = `${succ} Synced to Meta Pixel`;

      // Render Bot Accounts Live Performance Breakdown
      const chStatsCont = document.getElementById('channelBreakdownContainer') || document.getElementById('channelStatsContainer');
      if (chStatsCont) {
        const tagsSeen = new Set();
        const breakdown = [];

        for (const ch of allChannels) {
          tagsSeen.add(ch.tag);
          const isChan = ch.destinationType === 'channel' || (ch.link && (ch.link.includes('t.me/+') || ch.link.includes('t.me/joinchat')));
          breakdown.push({
            tag: ch.tag,
            name: ch.name || ch.tag,
            destinationType: isChan ? 'channel' : 'bot',
            totalJoins: stats.channelCounts?.[ch.tag] || 0,
            todayJoins: stats.channelTodayCounts?.[ch.tag] || 0,
            capiSuccess: stats.channelBreakdown?.find(b => b.tag === ch.tag)?.capiSuccess || 0,
            link: ch.link || ''
          });
        }

        // Catch any other dynamic channel tags found in DB
        for (const [tag, count] of Object.entries(stats.channelCounts || {})) {
          if (!tagsSeen.has(tag)) {
            breakdown.push({
              tag: tag,
              name: tag === 'ad1' ? 'South Boook' : tag.toUpperCase(),
              destinationType: 'bot',
              totalJoins: count,
              todayJoins: stats.channelTodayCounts?.[tag] || 0,
              capiSuccess: stats.channelBreakdown?.find(b => b.tag === tag)?.capiSuccess || 0,
              link: ''
            });
          }
        }

        window.currentBreakdownData = breakdown;

        // Update Pill Counts
        const chanCount = breakdown.filter(i => i.destinationType === 'channel').length;
        const botCount = breakdown.filter(i => i.destinationType === 'bot').length;
        document.getElementById('countAllBreakdown') && (document.getElementById('countAllBreakdown').textContent = breakdown.length);
        document.getElementById('countChanBreakdown') && (document.getElementById('countChanBreakdown').textContent = chanCount);
        document.getElementById('countBotBreakdown') && (document.getElementById('countBotBreakdown').textContent = botCount);

        renderFilteredBreakdownCards();
      }

      // Populate Conversion Funnel & Device Intelligence (Strictly Isolated for Channel Joins)
      const channelClicksCount = stats.channelClicks || 0;
      const funnelRateEl = document.getElementById('funnelConversionRate');
      if (funnelRateEl) {
        const rate = (channelClicksCount > 0)
          ? `${Math.round(((stats.channelJoins || 0) / channelClicksCount) * 100)}% Rate`
          : (stats.channelJoins > 0 ? '100% Direct' : '0% Rate');
        funnelRateEl.textContent = rate;
      }

      const funnelClicksEl = document.getElementById('funnelClicks');
      if (funnelClicksEl) funnelClicksEl.textContent = channelClicksCount;

      const funnelJoinsEl = document.getElementById('funnelJoins');
      if (funnelJoinsEl) funnelJoinsEl.textContent = stats.channelJoins || 0;

      // Channel-specific Device Intelligence (Zero contamination from Bot Chat clicks)
      const cDev = stats.channelDeviceStats || { iOS: 0, Android: 0, Desktop: 0 };
      const iosEl = document.getElementById('deviceIos');
      if (iosEl) iosEl.textContent = cDev.iOS || 0;
      const andEl = document.getElementById('deviceAndroid');
      if (andEl) andEl.textContent = cDev.Android || 0;
      const deskEl = document.getElementById('deviceDesktop');
      if (deskEl) deskEl.textContent = cDev.Desktop || 0;

      const activeEl = document.getElementById('retentionActive');
      if (activeEl) activeEl.textContent = stats.retention?.activeMembers || 0;
      const leftEl = document.getElementById('retentionLeft');
      if (leftEl) leftEl.textContent = stats.retention?.leftMembers || 0;

      // Anti-Bot Fraud Shield Counter & Protection Status
      const fraudBlockedEl = document.getElementById('fraudBlockedCount');
      if (fraudBlockedEl) fraudBlockedEl.textContent = stats.fraudBlockedCount || 0;
      const fraudStatusEl = document.getElementById('fraudShieldStatus');
      if (fraudStatusEl) {
        fraudStatusEl.textContent = '🟢 Active (100% Protected)';
      }

      // Platform Split (Facebook vs Instagram)
      const pStats = stats.platformStats || { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
      const fbClicksEl = document.getElementById('fbClicksCount');
      if (fbClicksEl) fbClicksEl.textContent = pStats.facebook?.clicks || 0;
      const fbJoinsEl = document.getElementById('fbJoinsCount');
      if (fbJoinsEl) fbJoinsEl.textContent = pStats.facebook?.joins || 0;
      const fbCREl = document.getElementById('fbConversionRate');
      if (fbCREl) fbCREl.textContent = `${pStats.facebook?.conversionRate || 0}% CR`;

      const igClicksEl = document.getElementById('igClicksCount');
      if (igClicksEl) igClicksEl.textContent = pStats.instagram?.clicks || 0;
      const igJoinsEl = document.getElementById('igJoinsCount');
      if (igJoinsEl) igJoinsEl.textContent = pStats.instagram?.joins || 0;
      const igCREl = document.getElementById('igConversionRate');
      if (igCREl) igCREl.textContent = `${pStats.instagram?.conversionRate || 0}% CR`;

      // Placement Types (Reels vs Stories vs Feeds)
      const plStats = stats.placementStats || { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
      const plReelsEl = document.getElementById('placementReels');
      if (plReelsEl) plReelsEl.textContent = `${(plStats.reels?.clicks || 0) + (plStats.reels?.joins || 0)}`;
      const plStoriesEl = document.getElementById('placementStories');
      if (plStoriesEl) plStoriesEl.textContent = `${(plStats.stories?.clicks || 0) + (plStats.stories?.joins || 0)}`;
      const plFeedEl = document.getElementById('placementFeed');
      if (plFeedEl) plFeedEl.textContent = `${(plStats.feed?.clicks || 0) + (plStats.feed?.joins || 0)}`;

      // State & Geographic Intelligence
      const statesCont = document.getElementById('topStatesContainer');
      if (statesCont) {
        const topStates = stats.geoStats?.topStates || [];
        if (topStates.length === 0) {
          statesCont.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; background: rgba(255,255,255,0.03); padding: 0.4rem 0.75rem; border-radius: 6px;">
              <span style="color: #fff; font-weight: 600;">🇮🇳 Maharashtra & Gujarat</span>
              <strong style="color: #38bdf8;">Top Regions</strong>
            </div>
          `;
        } else {
          let sHtml = '';
          for (const item of topStates) {
            sHtml += `
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; background: rgba(255,255,255,0.03); padding: 0.35rem 0.65rem; border-radius: 6px;">
                <span style="color: #fff; font-weight: 600;">📍 ${escapeHtml(item.state)}</span>
                <strong style="color: #38bdf8;">${item.count} Leads</strong>
              </div>
            `;
          }
          statesCont.innerHTML = sHtml;
        }
      }
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// ─── Multi-Channel Breakdown Filter Engine (Scalable for 40+ Channels) ────────
window.currentBreakdownFilter = 'all';

window.setBreakdownFilter = function(type) {
  window.currentBreakdownFilter = type;
  
  const btnAll = document.getElementById('btnFilterBreakdownAll');
  const btnChan = document.getElementById('btnFilterBreakdownChan');
  const btnBot = document.getElementById('btnFilterBreakdownBot');

  if (btnAll) {
    btnAll.style.background = type === 'all' ? 'rgba(56,189,248,0.2)' : 'transparent';
    btnAll.style.color = type === 'all' ? '#38bdf8' : 'rgba(255,255,255,0.6)';
  }
  if (btnChan) {
    btnChan.style.background = type === 'channel' ? 'rgba(56,189,248,0.2)' : 'transparent';
    btnChan.style.color = type === 'channel' ? '#38bdf8' : 'rgba(255,255,255,0.6)';
  }
  if (btnBot) {
    btnBot.style.background = type === 'bot' ? 'rgba(168,85,247,0.2)' : 'transparent';
    btnBot.style.color = type === 'bot' ? '#c084fc' : 'rgba(255,255,255,0.6)';
  }

  renderFilteredBreakdownCards();
};

window.filterBreakdownCards = function() {
  renderFilteredBreakdownCards();
};

function renderFilteredBreakdownCards() {
  const container = document.getElementById('channelBreakdownContainer') || document.getElementById('channelStatsContainer');
  if (!container) return;

  const data = window.currentBreakdownData || [];
  const query = (document.getElementById('searchChannelsBreakdown')?.value || document.getElementById('searchBreakdown')?.value || '').toLowerCase().trim();
  
  // On bot leads page, filter strictly to Bot Accounts!
  const isLeadsPage = document.body.getAttribute('data-page') === 'leads';
  let filtered = isLeadsPage ? data.filter(i => i.destinationType === 'bot') : data;

  if (query) {
    filtered = filtered.filter(i => 
      (i.name && i.name.toLowerCase().includes(query)) ||
      (i.tag && i.tag.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-4 text-center" style="grid-column: 1/-1;">
        <p class="text-muted" style="font-size:0.85rem;">No active bot accounts found.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    html += `
      <div class="channel-stat-card" style="background:rgba(20,14,40,0.85);border:1px solid rgba(168,85,247,0.25);border-radius:12px;padding:0.75rem 1rem;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;">
          <h4 style="font-size:0.85rem;font-weight:700;color:#fff;margin:0;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h4>
          <span style="font-size:9px;font-weight:800;background:rgba(168,85,247,0.15);color:#c084fc;padding:1px 5px;border-radius:4px;text-transform:uppercase;">${escapeHtml(item.tag)}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:0.4rem;margin-bottom:0.5rem;">
          <span style="font-size:1.4rem;font-weight:800;color:#c084fc;">${item.totalJoins}</span>
          <span style="font-size:0.75rem;color:rgba(255,255,255,0.5);">Bot Leads</span>
          <span style="font-size:0.7rem;font-weight:700;color:#10b981;margin-left:auto;">+${item.todayJoins} today</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.05);padding-top:0.4rem;">
          <span style="background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3);font-size:9px;padding:1px 5px;border-radius:4px;">💬 Direct DMs</span>
          <span style="font-size:9px;color:#10b981;font-weight:600;">✓ ${item.capiSuccess} Synced</span>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

async function loadLeads() {
  const search = document.getElementById('searchLeads')?.value || '';
  const channel = document.getElementById('channelFilter')?.value || 'all';
  const range = window.currentDateRange || 'all';
  const sDate = window.currentStartDate || '';
  const eDate = window.currentEndDate || '';

  try {
    const res = await fetch(`/api/leads?type=bot&search=${encodeURIComponent(search)}&channel=${encodeURIComponent(channel)}&range=${encodeURIComponent(range)}&startDate=${encodeURIComponent(sDate)}&endDate=${encodeURIComponent(eDate)}`);
    const json = await res.json();
    if (json.success) {
      renderLeadsTable(json.data);
    }
  } catch (err) {
    console.error('Error loading bot leads:', err);
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-6 text-muted">
          No bot leads found matching your criteria.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (const lead of leads) {
    const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Anonymous User';
    const usernameDisplay = lead.username ? `@${lead.username}` : 'None';
    const dateFormatted = new Date(lead.createdAt).toLocaleString();

    let capiBadge = '';
    if (lead.capiStatus === 'success') {
      capiBadge = `<span class="badge badge-success">✓ Synced</span>`;
    } else if (lead.capiStatus === 'failed') {
      capiBadge = `<span class="badge badge-danger" title="${escapeHtml(lead.capiError || 'Error')}">✗ Failed</span>`;
    } else {
      capiBadge = `<span class="badge badge-warning" title="${escapeHtml(lead.capiError || 'No Meta Pixel/Token configured')}">⚠️ Skipped</span>`;
    }

    const typeBadge = `<span class="badge" style="background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3);font-size:10px;padding:2px 6px;margin-top:4px;display:inline-block;">💬 Direct Bot Chat</span>`;

    html += `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar">${escapeHtml(fullName.charAt(0).toUpperCase())}</div>
            <div>
              <div class="user-name">${escapeHtml(fullName)}</div>
              <div class="user-handle">${escapeHtml(usernameDisplay)} • <span class="user-id">ID: ${lead.userId}</span></div>
            </div>
          </div>
        </td>
        <td>
          <span class="channel-badge">${escapeHtml(lead.channelName || lead.channelTag)}</span>
          <div>${typeBadge}</div>
        </td>
        <td>
          <code class="param-code">${escapeHtml(lead.rawParam || 'default')}</code>
        </td>
        <td>${capiBadge}</td>
        <td class="text-muted text-sm">${dateFormatted}</td>
        <td>
          <a href="/chat" class="btn btn-outline btn-sm" onclick="sessionStorage.setItem('pendingChatConv', '${lead.userId}_${lead.channelTag || 'default'}')">
            💬 Open Chat
          </a>
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
}

// ─── 📢 Dedicated Telegram Channel Analytics Controller ───────────────────────
async function loadChannelAnalytics() {
  const range = window.currentDateRange || 'all';
  const sDate = window.currentStartDate || '';
  const eDate = window.currentEndDate || '';

  try {
    const res = await fetch(`/api/stats?range=${encodeURIComponent(range)}&startDate=${encodeURIComponent(sDate)}&endDate=${encodeURIComponent(eDate)}`);
    const json = await res.json();
    if (json.success) {
      const stats = json.data;

      // 1. Top Channel KPIs
      const todayEl = document.getElementById('kpiChannelToday');
      if (todayEl) todayEl.textContent = stats.todayLeads || 0;

      const totalEl = document.getElementById('kpiChannelTotal');
      if (totalEl) totalEl.textContent = stats.channelJoins || 0;

      const retRateEl = document.getElementById('kpiChannelRetentionRate');
      const retCountsEl = document.getElementById('kpiRetentionCounts');
      const activeMem = stats.retention?.activeMembers || 0;
      const leftMem = stats.retention?.leftMembers || 0;
      const totalMem = activeMem + leftMem;
      const retRate = totalMem > 0 ? Math.round((activeMem / totalMem) * 100) : 100;
      if (retRateEl) retRateEl.textContent = `${retRate}%`;
      if (retCountsEl) retCountsEl.textContent = `${activeMem} Active / ${leftMem} Left`;

      const syncRateEl = document.getElementById('kpiChannelSyncRate');
      const syncCountsEl = document.getElementById('kpiChannelSyncCounts');
      const succ = stats.successfulCapi || 0;
      const fail = stats.failedCapi || 0;
      const totalSync = succ + fail;
      const syncRate = totalSync > 0 ? Math.round((succ / totalSync) * 100) : 100;
      if (syncRateEl) syncRateEl.textContent = `${syncRate}%`;
      if (syncCountsEl) syncCountsEl.textContent = `${succ} Synced to Pixel`;

      // 2. Funnel & Device Stats
      const clkEl = document.getElementById('funnelClicks');
      if (clkEl) clkEl.textContent = stats.channelClicks || stats.totalClicks || 0;
      const jnEl = document.getElementById('funnelJoins');
      if (jnEl) jnEl.textContent = stats.channelJoins || 0;
      const crEl = document.getElementById('funnelConversionRate');
      if (crEl) crEl.textContent = `${stats.conversionRate || 0}% Rate`;

      const cDev = stats.channelDeviceStats || stats.deviceStats || {};
      const iosEl = document.getElementById('deviceIos');
      if (iosEl) iosEl.textContent = cDev.iOS || 0;
      const andEl = document.getElementById('deviceAndroid');
      if (andEl) andEl.textContent = cDev.Android || 0;
      const deskEl = document.getElementById('deviceDesktop');
      if (deskEl) deskEl.textContent = cDev.Desktop || 0;

      const actEl = document.getElementById('retentionActive');
      if (actEl) actEl.textContent = activeMem;
      const lftEl = document.getElementById('retentionLeft');
      if (lftEl) lftEl.textContent = leftMem;

      const fraudBlockedEl = document.getElementById('fraudBlockedCount');
      if (fraudBlockedEl) fraudBlockedEl.textContent = stats.fraudBlockedCount || 0;

      // 3. Platform Split (FB vs IG)
      const pStats = stats.platformStats || { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
      const fbClicksEl = document.getElementById('fbClicksCount');
      if (fbClicksEl) fbClicksEl.textContent = pStats.facebook?.clicks || 0;
      const fbJoinsEl = document.getElementById('fbJoinsCount');
      if (fbJoinsEl) fbJoinsEl.textContent = pStats.facebook?.joins || 0;
      const fbCREl = document.getElementById('fbConversionRate');
      if (fbCREl) fbCREl.textContent = `${pStats.facebook?.conversionRate || 0}% CR`;

      const igClicksEl = document.getElementById('igClicksCount');
      if (igClicksEl) igClicksEl.textContent = pStats.instagram?.clicks || 0;
      const igJoinsEl = document.getElementById('igJoinsCount');
      if (igJoinsEl) igJoinsEl.textContent = pStats.instagram?.joins || 0;
      const igCREl = document.getElementById('igConversionRate');
      if (igCREl) igCREl.textContent = `${pStats.instagram?.conversionRate || 0}% CR`;

      // 4. Placements
      const plStats = stats.placementStats || { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
      const plReelsEl = document.getElementById('placementReels');
      if (plReelsEl) plReelsEl.textContent = `${(plStats.reels?.clicks || 0) + (plStats.reels?.joins || 0)}`;
      const plStoriesEl = document.getElementById('placementStories');
      if (plStoriesEl) plStoriesEl.textContent = `${(plStats.stories?.clicks || 0) + (plStats.stories?.joins || 0)}`;
      const plFeedEl = document.getElementById('placementFeed');
      if (plFeedEl) plFeedEl.textContent = `${(plStats.feed?.clicks || 0) + (plStats.feed?.joins || 0)}`;

      // 5. State & Geo
      const statesCont = document.getElementById('topStatesContainer');
      if (statesCont) {
        const topStates = stats.geoStats?.topStates || [];
        if (topStates.length === 0) {
          statesCont.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; background: rgba(255,255,255,0.03); padding: 0.4rem 0.75rem; border-radius: 6px;">
              <span style="color: #fff; font-weight: 600;">🇮🇳 All States</span>
              <strong style="color: #38bdf8;">100% India</strong>
            </div>
          `;
        } else {
          let sHtml = '';
          for (const item of topStates) {
            sHtml += `
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; background: rgba(255,255,255,0.03); padding: 0.35rem 0.65rem; border-radius: 6px;">
                <span style="color: #fff; font-weight: 600;">📍 ${escapeHtml(item.state)}</span>
                <strong style="color: #38bdf8;">${item.count} Subscribers</strong>
              </div>
            `;
          }
          statesCont.innerHTML = sHtml;
        }
      }

      // 6. Channel List Container Only
      renderChannelOnlyCards(stats.channelBreakdown || []);
    }
  } catch (err) {
    console.error('Error loading channel analytics:', err);
  }
}

function renderChannelOnlyCards(breakdown) {
  const container = document.getElementById('channelListContainerOnly');
  if (!container) return;

  const channelsOnly = breakdown.filter(c => c.destinationType === 'channel');
  const query = (document.getElementById('searchChannelPage')?.value || '').toLowerCase().trim();

  let filtered = channelsOnly;
  if (query) {
    filtered = filtered.filter(i => 
      (i.name && i.name.toLowerCase().includes(query)) ||
      (i.tag && i.tag.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-4 text-center" style="grid-column: 1/-1;">
        <p class="text-muted" style="font-size:0.85rem;">No Telegram channels found.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    html += `
      <div class="channel-stat-card" style="background:rgba(20,14,40,0.85);border:1px solid rgba(6,182,212,0.25);border-radius:12px;padding:0.75rem 1rem;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;">
          <h4 style="font-size:0.85rem;font-weight:700;color:#fff;margin:0;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h4>
          <span style="font-size:9px;font-weight:800;background:rgba(56,189,248,0.15);color:#38bdf8;padding:1px 5px;border-radius:4px;text-transform:uppercase;">${escapeHtml(item.tag)}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:0.4rem;margin-bottom:0.5rem;">
          <span style="font-size:1.4rem;font-weight:800;color:#38bdf8;">${item.totalJoins}</span>
          <span style="font-size:0.75rem;color:rgba(255,255,255,0.5);">Subscribers</span>
          <span style="font-size:0.7rem;font-weight:700;color:#10b981;margin-left:auto;">+${item.todayJoins} today</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.05);padding-top:0.4rem;">
          <span style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-size:9px;padding:1px 5px;border-radius:4px;">📢 Auto-Approved</span>
          <span style="font-size:9px;color:#10b981;font-weight:600;">✓ ${item.capiSuccess} Synced</span>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

window.filterChannelsListOnly = function() {
  loadChannelAnalytics();
};

async function loadChannelAnalyticsLeads() {
  const searchInput = document.getElementById('searchChannelSubscribers');
  const search = searchInput ? searchInput.value.trim() : '';
  const filterSelect = document.getElementById('channelSelectFilterOnly');
  const channel = filterSelect ? filterSelect.value : 'all';

  const range = window.currentDateRange || 'all';
  const sDate = window.currentStartDate || '';
  const eDate = window.currentEndDate || '';

  try {
    const res = await fetch(`/api/leads?type=channel&search=${encodeURIComponent(search)}&channel=${encodeURIComponent(channel)}&range=${encodeURIComponent(range)}&startDate=${encodeURIComponent(sDate)}&endDate=${encodeURIComponent(eDate)}`);
    const json = await res.json();
    if (json.success) {
      renderChannelSubscribersTable(json.data);
    }
  } catch (err) {
    console.error('Error loading channel subscribers:', err);
  }
}

function renderChannelSubscribersTable(leads) {
  const tbody = document.getElementById('channelSubscribersTableBody');
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-6 text-muted">
          No channel subscribers found matching your criteria.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (const lead of leads) {
    const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Anonymous User';
    const usernameDisplay = lead.username ? `@${lead.username}` : 'None';
    const dateFormatted = new Date(lead.createdAt).toLocaleString();

    let capiBadge = '';
    if (lead.capiStatus === 'success') {
      capiBadge = `<span class="badge badge-success">✓ Synced (Subscribe)</span>`;
    } else if (lead.capiStatus === 'failed') {
      capiBadge = `<span class="badge badge-danger" title="${escapeHtml(lead.capiError || 'Error')}">✗ Failed</span>`;
    } else {
      capiBadge = `<span class="badge badge-warning" title="${escapeHtml(lead.capiError || 'No Meta Pixel/Token configured')}">⚠️ Skipped</span>`;
    }

    const isLeft = lead.retentionStatus === 'left';
    const statusBadge = isLeft
      ? `<span class="badge badge-danger" style="font-size:10px;padding:2px 6px;">👋 Left Channel</span>`
      : `<span class="badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-size:10px;padding:2px 6px;">⚡ Auto-Approved</span>`;

    html += `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar" style="background: linear-gradient(135deg,#06b6d4,#38bdf8);">${escapeHtml(fullName.charAt(0).toUpperCase())}</div>
            <div>
              <div class="user-name">${escapeHtml(fullName)}</div>
              <div class="user-handle">${escapeHtml(usernameDisplay)} • <span class="user-id">ID: ${lead.userId}</span></div>
            </div>
          </div>
        </td>
        <td>
          <span class="channel-badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);">${escapeHtml(lead.channelName || lead.channelTag)}</span>
        </td>
        <td>
          <code class="param-code">${escapeHtml(lead.rawParam || 'channel_join')}</code>
        </td>
        <td>${capiBadge}</td>
        <td class="text-muted text-sm">${dateFormatted}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
}

async function loadChannels() {
  const channelsCont = document.getElementById('channelsListContainer');
  const linksCont = document.getElementById('adLinksList');
  if (channelsCont && (!allChannels || allChannels.length === 0)) {
    channelsCont.innerHTML = `
      <div class="empty-state py-8 text-center" style="grid-column: 1/-1;">
        <div class="loading-spinner" style="width:28px; height:28px; margin:0 auto;"></div>
        <p class="text-muted mt-2">Loading accounts & channels...</p>
      </div>
    `;
  }
  if (linksCont && (!allChannels || allChannels.length === 0)) {
    linksCont.innerHTML = `
      <div class="empty-state py-8 text-center">
        <div class="loading-spinner" style="width:28px; height:28px; margin:0 auto;"></div>
        <p class="text-muted mt-2">Loading destination URLs...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/channels');
    const json = await res.json();
    if (json.success) {
      allChannels = json.data || [];
      renderChannels(allChannels);
      renderChannelFilter(allChannels);
      renderAdLinks(allChannels);
    }
  } catch (err) {
    console.error('Error loading channels:', err);
  }
}

window.currentChannelsPageFilter = 'all';

window.setChannelsPageFilter = function(type) {
  window.currentChannelsPageFilter = type;
  const btnAll = document.getElementById('btnFilterChanPageAll');
  const btnChan = document.getElementById('btnFilterChanPageChan');
  const btnBot = document.getElementById('btnFilterChanPageBot');

  if (btnAll) {
    btnAll.style.background = type === 'all' ? 'rgba(56,189,248,0.2)' : 'transparent';
    btnAll.style.color = type === 'all' ? '#38bdf8' : 'rgba(255,255,255,0.6)';
  }
  if (btnChan) {
    btnChan.style.background = type === 'channel' ? 'rgba(56,189,248,0.2)' : 'transparent';
    btnChan.style.color = type === 'channel' ? '#38bdf8' : 'rgba(255,255,255,0.6)';
  }
  if (btnBot) {
    btnBot.style.background = type === 'bot' ? 'rgba(168,85,247,0.2)' : 'transparent';
    btnBot.style.color = type === 'bot' ? '#c084fc' : 'rgba(255,255,255,0.6)';
  }

  renderChannels(allChannels);
};

window.filterChannelsPageCards = function() {
  renderChannels(allChannels);
};

function renderChannels(channels) {
  const container = document.getElementById('channelsListContainer');
  if (!container) return;

  const query = (document.getElementById('searchChannelsPage')?.value || '').toLowerCase().trim();
  const filter = window.currentChannelsPageFilter || 'all';

  let filtered = channels;
  if (filter === 'channel') {
    filtered = filtered.filter(ch => ch.destinationType === 'channel' || (ch.link && (ch.link.includes('t.me/+') || ch.link.includes('t.me/joinchat'))));
  } else if (filter === 'bot') {
    filtered = filtered.filter(ch => ch.destinationType !== 'channel' && (!ch.link || (!ch.link.includes('t.me/+') && !ch.link.includes('t.me/joinchat'))));
  }

  if (query) {
    filtered = filtered.filter(ch => 
      (ch.name && ch.name.toLowerCase().includes(query)) ||
      (ch.tag && ch.tag.toLowerCase().includes(query)) ||
      (ch.botUsername && ch.botUsername.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center" style="grid-column: 1/-1;">
        <p class="text-muted">No accounts match the current filter.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const ch of filtered) {
    const hasPixel = !!ch.pixelId;
    const hasBot = !!ch.botToken;
    const isChannel = ch.destinationType === 'channel' || (ch.link && (ch.link.includes('t.me/+') || ch.link.includes('t.me/joinchat')));

    html += `
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <span class="tag-pill">${escapeHtml(ch.tag)}</span>
            <h3 class="channel-card-title">${escapeHtml(ch.name)}</h3>
          </div>
          <div class="channel-card-actions">
            <button class="btn-icon" onclick="editChannel('${ch.tag}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="deleteChannel('${ch.tag}')" title="Delete">🗑️</button>
          </div>
        </div>

        <div class="channel-card-body">
          <div class="info-row">
            <span class="info-label">Account Type:</span>
            <span class="info-value">${isChannel ? '📢 Telegram Channel (1-Sec Auto-Approve)' : '💬 Direct Bot Chat (2-Way Live Support)'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${isChannel ? 'Channel Link:' : 'Personal/Support Link:'}</span>
            <a href="${escapeHtml(ch.link)}" target="_blank" class="info-value text-accent">${escapeHtml(ch.link)}</a>
          </div>
          <div class="info-row">
            <span class="info-label">${isChannel ? 'Approval Bot:' : 'Telegram Bot:'}</span>
            <span class="info-value">${ch.botUsername ? `🟢 @${escapeHtml(ch.botUsername)}` : (hasBot ? '🟢 Dedicated Bot Active' : '⚪ Master Bot (.env)')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Meta Pixel:</span>
            <span class="info-value">${hasPixel ? `🟢 ${escapeHtml(ch.pixelId)}` : '⚪ Master Pixel (.env)'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Subscribers / Leads:</span>
            <span class="info-value" style="color:#38bdf8; font-weight:700;">👥 Live Tracking</span>
          </div>
          <div class="info-row">
            <span class="info-label">Client PIN:</span>
            <span class="info-value" style="color:#818cf8; font-weight:700;">🔑 ${escapeHtml(ch.accessPin || '1234')}</span>
          </div>
          
          <!-- Action Links Box -->
          <div class="channel-client-link-box" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 0.5rem; justify-content: space-between; align-items: center;">
            ${isChannel ? `
              <button class="btn btn-outline btn-sm" onclick="copyToClipboard('${escapeHtml(ch.link)}')" style="font-size: 0.8rem; flex: 1;" title="Copy Telegram Channel Invite Link">
                🔗 Copy Channel Link
              </button>
              <a href="${escapeHtml(ch.link)}" target="_blank" class="btn btn-outline btn-sm" style="font-size: 0.8rem;" title="Open Channel in Telegram">
                👁️ Open Telegram
              </a>
            ` : `
              <button class="btn btn-outline btn-sm" onclick="copyClientChatLink('${escapeHtml(ch.tag)}', '${escapeHtml(ch.accessPin || '1234')}')" style="font-size: 0.8rem; flex: 1;" title="Copy private link for client">
                🔗 Copy Client Chat Link
              </button>
              <a href="/client/${escapeHtml(ch.tag)}" target="_blank" class="btn btn-outline btn-sm" style="font-size: 0.8rem;" title="Preview isolated chat view">
                👁️ Open Chat View
              </a>
            `}
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

window.copyClientChatLink = function(tag, pin = '1234') {
  const directUrl = `${window.location.origin}/client/${encodeURIComponent(tag)}`;
  const autoUrl = `${window.location.origin}/client/${encodeURIComponent(tag)}?pin=${encodeURIComponent(pin)}`;
  
  const choice = confirm(`🔐 Client Chat Link for "${tag}":\n\n📌 Client PIN: ${pin}\n\n• Click [OK] to Copy 1-Click Auto-Login Link (Direct chat):\n${autoUrl}\n\n• Click [Cancel] to Copy Standard Link (Client enters PIN manually):\n${directUrl}`);

  const targetUrl = choice ? autoUrl : directUrl;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(targetUrl).then(() => {
      alert(`✅ Link Copied to Clipboard!\n\n🔗 ${targetUrl}\n\n👉 Send this link to your client (${tag}).`);
    }).catch(() => {
      prompt('Copy Client Chat Link:', targetUrl);
    });
  } else {
    prompt('Copy Client Chat Link:', targetUrl);
  }
};

function renderChannelFilter(channels) {
  const filter = document.getElementById('channelFilter');
  if (filter) {
    const currentVal = filter.value;
    let html = '<option value="all">All Bot Accounts</option>';
    for (const ch of channels.filter(c => c.destinationType !== 'channel')) {
      html += `<option value="${ch.tag}">${escapeHtml(ch.name)} (${ch.tag})</option>`;
    }
    filter.innerHTML = html;
    filter.value = currentVal || 'all';
  }

  const chanFilter = document.getElementById('channelSelectFilterOnly');
  if (chanFilter) {
    const currentVal = chanFilter.value;
    let html = '<option value="all">All Telegram Channels</option>';
    for (const ch of channels.filter(c => c.destinationType === 'channel')) {
      html += `<option value="${ch.tag}">${escapeHtml(ch.name)} (${ch.tag})</option>`;
    }
    chanFilter.innerHTML = html;
    chanFilter.value = currentVal || 'all';
  }
}

function renderAdLinks(channels) {
  const container = document.getElementById('adLinksList');
  if (!container) return;

  if (channels.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center">
        <p class="text-muted">No accounts available to generate links. Add an account first!</p>
      </div>
    `;
    return;
  }

  const baseUrl = window.location.origin; // e.g. https://telegram-chat-l174.onrender.com

  let html = '';
  for (const ch of channels) {
    const targetBot = (ch.botUsername ? ch.botUsername.replace(/^@/, '').trim() : '') || botUsername;
    const isChannel = ch.destinationType === 'channel' || (ch.link && (ch.link.includes('t.me/+') || ch.link.includes('t.me/joinchat')));

    // Standard Bridge URL
    const bridgeUrl = `${baseUrl}/go?c=${ch.tag}&fbclid={{fbclid}}`;

    // Advanced Dynamic URL with Ad ID + Creative Name + Platform + Placement
    const dynamicAdUrl = `${baseUrl}/go?c=${ch.tag}&ad_id={{ad.id}}&ad_name={{ad.name}}&platform={{site_source_name}}&placement={{placement}}&fbclid={{fbclid}}`;

    // Direct Telegram link
    const standardUrl = isChannel && ch.link ? ch.link : `https://t.me/${targetBot}?start=${ch.tag}`;

    html += `
      <div class="link-item-card">
        <div class="link-item-header">
          <h4>${escapeHtml(ch.name)} <span class="tag-pill">${escapeHtml(ch.tag)}</span></h4>
          <span class="text-muted text-sm">
            ${isChannel ? '📢 <strong>Telegram Channel Auto-Approval</strong>' : '💬 <strong>Direct Bot Live Chat</strong>'} • Target: ${escapeHtml(ch.link || `@${targetBot}`)}
          </span>
        </div>

        <!-- PRIMARY: Bridge URL with Dynamic Ad Tracking (EXACT AD ID + CPR) -->
        <div class="link-input-group">
          <label style="display:flex;align-items:center;gap:0.4rem;">
            <span style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;font-size:0.65rem;font-weight:800;padding:3px 9px;border-radius:99px;box-shadow:0 0 10px rgba(139,92,246,0.4);">🔥 DYNAMIC AD TRACKING (EXACT AD ID & CREATIVE)</span>
            Website URL — Auto-captures Ad ID, Reel/Banner Name & CPR:
          </label>
          <div class="copy-input-wrap">
            <input type="text" readonly value="${dynamicAdUrl}" />
            <button class="btn btn-primary btn-sm" onclick="copyToClipboard('${dynamicAdUrl}')">Copy URL</button>
          </div>
          <p style="font-size:0.75rem;color:rgba(255,255,255,0.55);margin-top:0.35rem;">
            💡 <b>Meta Ads Manager → Website URL</b> me paste karein. Meta automatically Reel/Banner ka naam aur ID hamare dashboard aur Meta CAPI ko bhejega!
          </p>
        </div>

        <!-- SECONDARY: Standard Bridge URL -->
        <div class="link-input-group mt-2">
          <label style="display:flex;align-items:center;gap:0.4rem;">
            <span style="background:#06b6d4;color:#000;font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:99px;">STANDARD</span>
            Simple Ad Link (Tag + fbclid):
          </label>
          <div class="copy-input-wrap">
            <input type="text" readonly value="${bridgeUrl}" />
            <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('${bridgeUrl}')">Copy URL</button>
          </div>
        </div>

        <!-- BACKUP: Direct Telegram -->
        <div class="link-input-group mt-2">
          <label style="display:flex;align-items:center;gap:0.4rem;">
            <span style="background:#475569;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:99px;">BACKUP</span>
            Direct Telegram Link:
          </label>
          <div class="copy-input-wrap">
            <input type="text" readonly value="${standardUrl}" />
            <button class="btn btn-outline btn-sm" onclick="copyToClipboard('${standardUrl}')">Copy URL</button>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Modal Handlers
window.openChannelModal = function(channel = null) {
  const modal = document.getElementById('channelModal');
  const title = document.getElementById('modalTitle');
  if (!modal) return;

  if (channel) {
    if (title) title.textContent = `Edit Account / Channel: ${channel.name}`;
    document.getElementById('inputTag').value = channel.tag || '';
    document.getElementById('inputTag').disabled = true;
    document.getElementById('inputName').value = channel.name || '';
    if (document.getElementById('inputDestinationType')) {
      const isChan = channel.destinationType === 'channel' || (channel.link && (channel.link.includes('t.me/+') || channel.link.includes('t.me/joinchat')));
      document.getElementById('inputDestinationType').value = isChan ? 'channel' : 'bot';
    }
    if (document.getElementById('inputBotUsername')) {
      document.getElementById('inputBotUsername').value = channel.botUsername || channel.name || '';
    }
    document.getElementById('inputLink').value = channel.link || '';
    document.getElementById('inputBotToken').value = channel.botToken || '';
    if (document.getElementById('inputPixelId')) document.getElementById('inputPixelId').value = channel.pixelId || '';
    if (document.getElementById('inputAccessToken')) document.getElementById('inputAccessToken').value = channel.accessToken || '';
    if (document.getElementById('inputAccessPin')) document.getElementById('inputAccessPin').value = channel.accessPin || '1234';
  } else {
    if (title) title.textContent = 'Add Telegram Channel / Bot Account';
    document.getElementById('inputTag').value = '';
    document.getElementById('inputTag').disabled = false;
    document.getElementById('inputName').value = '';
    if (document.getElementById('inputDestinationType')) {
      document.getElementById('inputDestinationType').value = 'bot';
    }
    if (document.getElementById('inputBotUsername')) {
      document.getElementById('inputBotUsername').value = '';
    }
    document.getElementById('inputLink').value = '';
    if (document.getElementById('inputBotToken')) document.getElementById('inputBotToken').value = '';
    if (document.getElementById('inputPixelId')) document.getElementById('inputPixelId').value = '';
    if (document.getElementById('inputAccessToken')) document.getElementById('inputAccessToken').value = '';
    if (document.getElementById('inputAccessPin')) document.getElementById('inputAccessPin').value = '1234';
  }

  modal.classList.add('active');
};

window.editChannel = function(tag) {
  const ch = allChannels.find(c => c.tag === tag);
  if (ch) openChannelModal(ch);
};

window.deleteChannel = async function(tag) {
  if (!confirm(`Are you sure you want to delete "${tag}"?`)) return;

  try {
    const res = await fetch(`/api/channels/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      await loadChannels();
    } else {
      alert('Failed to delete: ' + (json.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error deleting: ' + err.message);
  }
};

async function handleSaveChannel(e) {
  e.preventDefault();

  const tag = document.getElementById('inputTag')?.value.trim();
  const name = document.getElementById('inputName')?.value.trim();
  const destType = document.getElementById('inputDestinationType')?.value || 'bot';
  const botUser = document.getElementById('inputBotUsername')?.value.replace(/^@/, '').trim();
  const link = document.getElementById('inputLink')?.value.trim();

  if (!tag || !link) {
    alert('Please fill in both Campaign Tag and Target Link / Username.');
    return;
  }

  const payload = {
    tag: tag,
    name: name || tag,
    destinationType: destType,
    botUsername: botUser || '',
    link: link,
    botToken: document.getElementById('inputBotToken')?.value.trim() || '',
    pixelId: document.getElementById('inputPixelId')?.value.trim() || '',
    accessToken: document.getElementById('inputAccessToken')?.value.trim() || '',
    accessPin: document.getElementById('inputAccessPin')?.value.trim() || '1234'
  };

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    if (json.success) {
      document.getElementById('channelModal')?.classList.remove('active');
      await loadChannels();
      alert(`✅ Account "${payload.name}" (${payload.tag}) saved successfully!`);
    } else {
      alert('Error: ' + (json.error || 'Failed to save account'));
    }
  } catch (err) {
    alert('Network error saving account: ' + err.message);
  }
}

async function handleSendTestLead() {
  const btn = document.getElementById('btnTestLead');
  if (!btn) return;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner" style="width:14px; height:14px; display:inline-block;"></span> Sending...';
  btn.disabled = true;

  try {
    const firstTag = allChannels.length > 0 ? allChannels[0].tag : 'ad1';
    const res = await fetch('/api/test-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelTag: firstTag, customParam: `${firstTag}_test_ad` })
    });

    const json = await res.json();
    if (json.success) {
      await loadStats();
      await loadLeads();
      await loadConversations();
      alert(`✅ Test Lead Created!\nChannel: ${firstTag}\nCAPI Status: ${json.lead.capiStatus.toUpperCase()}`);
    }
  } catch (err) {
    alert('Error sending test lead: ' + err.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard:\n' + text);
  }).catch(err => {
    prompt('Copy this URL:', text);
  });
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Admin Authentication Guard ───────────────────────────────────────────────
function checkAdminAuth() {
  const token = localStorage.getItem('teletrack_admin_auth');
  if (token) {
    addLogoutButton();
    return true;
  }

  // Render Admin Lock Overlay
  let overlay = document.getElementById('adminAuthOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'adminAuthOverlay';
    overlay.className = 'auth-lock-overlay';
    overlay.innerHTML = `
      <div class="auth-lock-card">
        <div class="auth-lock-icon">👑</div>
        <h2 class="auth-lock-title">Master Admin Panel</h2>
        <p class="auth-lock-desc">Enter your Master Admin password to access chats, leads & configurations.</p>
        <form id="adminAuthForm">
          <div class="auth-input-wrap">
            <input type="password" id="adminPasswordInput" class="auth-input" placeholder="Enter Admin Password..." required autocomplete="current-password" />
            <div class="auth-error-text" id="adminAuthError"></div>
          </div>
          <button type="submit" class="btn-auth-submit" id="btnAdminLogin">
            🔓 Unlock Admin Panel
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('adminAuthForm');
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminAuthError');
    const btn = document.getElementById('btnAdminLogin');

    if (input) setTimeout(() => input.focus(), 150);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = input.value.trim();
      if (!pass) return;

      btn.disabled = true;
      btn.textContent = 'Verifying...';
      errorEl.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass, role: 'admin' })
        });
        const json = await res.json();
        if (json.success) {
          localStorage.setItem('teletrack_admin_auth', json.token || '1');
          overlay.remove();
          addLogoutButton();
          // Load app data
          loadAppConfig();
          loadStats();
          loadChannels();
          loadLeads();
          loadConversations();
        } else {
          errorEl.textContent = '❌ ' + (json.error || 'Incorrect Password');
          errorEl.style.display = 'block';
          input.value = '';
          input.focus();
        }
      } catch (err) {
        errorEl.textContent = '⚠️ Network error: ' + err.message;
        errorEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = '🔓 Unlock Admin Panel';
      }
    });
  }

  return false;
}

function addLogoutButton() {
  const actions = document.querySelector('.nav-actions');
  if (!actions || document.getElementById('btnAdminLogout')) return;

  const btn = document.createElement('button');
  btn.id = 'btnAdminLogout';
  btn.className = 'btn btn-sm btn-auth-logout';
  btn.innerHTML = '🔒 Lock';
  btn.title = 'Lock Admin Panel and Log Out';
  btn.onclick = () => {
    if (confirm('Are you sure you want to lock the Admin Panel and log out?')) {
      localStorage.removeItem('teletrack_admin_auth');
      window.location.reload();
    }
  };
  actions.appendChild(btn);
}
