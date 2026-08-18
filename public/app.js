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
  initEventListeners();
  initChannelModalListeners();

  // Load appropriate data safely
  loadAppConfig();
  loadStats();
  loadChannels();
  loadLeads();
  loadConversations();
});

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
          const botPrefix = (msg.botToken || '').split(':')[0];
          const matchedChan = allChannels.find(c => (msg.channelTag && c.tag === msg.channelTag) || (botPrefix && c.botToken && c.botToken.startsWith(botPrefix)));
          const chTag = matchedChan ? matchedChan.tag : (msg.channelTag || 'default');
          const msgConvKey = `${msg.userId}_${chTag}`;

          // If message is in active open chat room, render instantly (0ms)
          if (activeChatUserId && (String(activeChatUserId) === msgConvKey || String(activeChatUserId) === `${msg.userId}_${msg.channelTag}`)) {
            appendMessageBubbleDirectly(msg);
          } else if (!activeChatUserId && window.innerWidth > 768) {
            selectConversation(msgConvKey);
          }

          // Sound & OS Notification for customer messages
          if (msg.sender === 'user') {
            playNotificationChime();
            showSystemNotification(`New Message from ${msg.userName || 'Customer'}`, msg.text || '[Media]', msg.userId);
          }

          // Refresh conversation sidebar badge & last message instantly
          loadConversations(true);
        } else if (payload.type === 'new_lead') {
          loadStats();
          loadLeads();
          loadConversations(true);
        }
      } catch (err) {}
    };

    es.onerror = () => {
      // Reconnects automatically
    };
  } catch (err) {
    console.warn('SSE connection notice:', err);
  }
}

// Directly append message bubble in 0ms without full DOM reload
function appendMessageBubbleDirectly(m) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const isAdmin = m.sender === 'admin';
  const timeFormatted = formatTimeOnly(m.createdAt || new Date());

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = `message-bubble ${isAdmin ? 'bubble-admin' : 'bubble-user'}`;
  bubbleDiv.innerHTML = `
    <div class="bubble-sender">${isAdmin ? '🛡️ You (via Bot)' : `👤 ${escapeHtml(m.userName || 'Customer')}`}</div>
    <div class="bubble-text">${escapeHtml(m.text)}</div>
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

// Highlight active top nav button based on URL
function highlightCurrentNav() {
  const path = window.location.pathname;
  const links = document.querySelectorAll('.nav-link-btn');
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
      btnInstall.innerHTML = '⬇️ Install App';
      btnInstall.style.background = 'linear-gradient(135deg, var(--accent-cyan), var(--accent-primary))';
      btnInstall.style.color = '#ffffff';
      btnInstall.style.borderColor = 'transparent';
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btnInstall) {
      btnInstall.innerHTML = '✅ Installed';
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
          btnInstall.innerHTML = '✅ Installed';
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

window.openPwaModal = function() {
  const modal = document.getElementById('pwaGuideModal');
  if (modal) modal.classList.add('active');
};

window.closePwaModal = function() {
  const modal = document.getElementById('pwaGuideModal');
  if (modal) modal.classList.remove('active');
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
  activeChatUserId = String(convKey);
  const conv = allConversations.find(c => String(c.convId || c.userId) === String(convKey));

  if (conv) {
    conv.unreadCount = 0;
  }

  // Mark read in DB in background
  fetch(`/api/chat/read/${convKey}`, { method: 'POST' }).catch(() => {});

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

  renderConversationsList(allConversations);
  await loadActiveChatMessages(convKey);

  document.getElementById('chatMessageInput')?.focus();
};

async function loadActiveChatMessages(userId, isSilent = false) {
  if (!userId) return;
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  try {
    const res = await fetch(`/api/chat/messages/${userId}`);
    const json = await res.json();
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

  const currentKey = messages.map(m => m.id + (m.createdAt || '')).join('|');
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
        <div class="bubble-text">${escapeHtml(m.text)}</div>
        <div class="message-time">${timeFormatted} ${isAdmin ? '✓✓' : ''}</div>
      </div>
    `;
  }

  container.innerHTML = html;

  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    const tempHtml = `
      <div class="message-bubble bubble-admin" style="opacity:0.85;">
        <div class="bubble-sender">🛡️ You (via Bot)</div>
        <div class="bubble-text">${escapeHtml(text)}</div>
        <div class="message-time">${formatTimeOnly(new Date())} ⏳</div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', tempHtml);
    container.scrollTop = container.scrollHeight;
  }

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeChatUserId, text: text })
    });

    const json = await res.json();
    if (json.success) {
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

// ============================================================
// 📊 STATS, LEADS, CHANNELS, & LINKS LOGIC
// ============================================================

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (json.success) {
      const stats = json.data;
      const todayEl = document.getElementById('kpiTodayLeads');
      if (todayEl) todayEl.textContent = stats.todayLeads || 0;

      const totalEl = document.getElementById('kpiTotalLeads');
      if (totalEl) totalEl.textContent = stats.totalLeads || 0;

      const activeChatsEl = document.getElementById('kpiActiveChats');
      if (activeChatsEl && stats.activeChats !== undefined) {
        activeChatsEl.textContent = stats.activeChats;
      }

      const syncRateEl = document.getElementById('kpiSyncRate');
      const syncCountEl = document.getElementById('kpiSyncCount');
      if (syncRateEl && syncCountEl) {
        const totalSyncAttempts = (stats.successfulCapi || 0) + (stats.failedCapi || 0);
        const rate = totalSyncAttempts > 0 ? Math.round((stats.successfulCapi / totalSyncAttempts) * 100) : 100;
        syncRateEl.textContent = `${rate}%`;
        syncCountEl.textContent = `${stats.successfulCapi || 0} Synced / ${stats.failedCapi || 0} Failed`;
      }
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

async function loadLeads() {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;

  const search = document.getElementById('searchLeads')?.value || '';
  const channel = document.getElementById('channelFilter')?.value || 'all';

  try {
    const res = await fetch(`/api/leads?search=${encodeURIComponent(search)}&channel=${encodeURIComponent(channel)}`);
    const json = await res.json();
    if (json.success) {
      renderLeadsTable(json.data);
    }
  } catch (err) {
    console.error('Error loading leads:', err);
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-6 text-muted">
          No leads found matching your criteria.
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
      capiBadge = `<span class="badge badge-warning" title="Missing Meta credentials in .env">⚠️ Skipped</span>`;
    }

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

async function loadChannels() {
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

function renderChannels(channels) {
  const container = document.getElementById('channelsListContainer');
  if (!container) return;

  if (channels.length === 0) {
    container.innerHTML = `
      <div class="empty-state py-8 text-center">
        <p class="text-muted">No accounts added yet. Click "+ Add Account / Channel" above to add one!</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const ch of channels) {
    const hasPixel = !!ch.pixelId;
    const hasBot = !!ch.botToken;

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
            <span class="info-label">Direct Account:</span>
            <a href="${escapeHtml(ch.link)}" target="_blank" class="info-value text-accent">${escapeHtml(ch.link)}</a>
          </div>
          <div class="info-row">
            <span class="info-label">Custom Bot:</span>
            <span class="info-value">${ch.botUsername ? `🟢 @${escapeHtml(ch.botUsername)}` : (hasBot ? '🟢 Dedicated Bot Active' : '⚪ Master Bot (.env)')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Meta Pixel:</span>
            <span class="info-value">${hasPixel ? `🟢 ${escapeHtml(ch.pixelId)}` : '⚪ Master Pixel (.env)'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Welcome Msg:</span>
            <span class="info-value text-truncate">${escapeHtml(ch.welcomeMessage || 'Default')}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderChannelFilter(channels) {
  const filter = document.getElementById('channelFilter');
  if (!filter) return;

  const currentVal = filter.value;
  let html = '<option value="all">All Accounts / Ads</option>';
  for (const ch of channels) {
    html += `<option value="${ch.tag}">${escapeHtml(ch.name)} (${ch.tag})</option>`;
  }
  filter.innerHTML = html;
  filter.value = currentVal || 'all';
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

  let html = '';
  for (const ch of channels) {
    const targetBot = (ch.botUsername ? ch.botUsername.replace(/^@/, '').trim() : '') || botUsername;
    const standardUrl = `https://t.me/${targetBot}?start=${ch.tag}`;
    const dynamicUrl = `https://t.me/${targetBot}?start=${ch.tag}_{{ad.id}}`;

    html += `
      <div class="link-item-card">
        <div class="link-item-header">
          <h4>${escapeHtml(ch.name)} <span class="tag-pill">${escapeHtml(ch.tag)}</span></h4>
          <span class="text-muted text-sm">Bot: <strong>@${escapeHtml(targetBot)}</strong> • Routes to: ${escapeHtml(ch.link)}</span>
        </div>

        <div class="link-input-group">
          <label>Meta Ad Website URL (Recommended for FB/Insta Ads):</label>
          <div class="copy-input-wrap">
            <input type="text" readonly value="${dynamicUrl}" />
            <button class="btn btn-primary btn-sm" onclick="copyToClipboard('${dynamicUrl}')">Copy URL</button>
          </div>
        </div>

        <div class="link-input-group mt-2">
          <label>Direct Simple Link:</label>
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
    if (title) title.textContent = `Edit Account: ${channel.name}`;
    document.getElementById('inputTag').value = channel.tag || '';
    document.getElementById('inputTag').disabled = true;
    document.getElementById('inputName').value = channel.name || '';
    if (document.getElementById('inputBotUsername')) {
      document.getElementById('inputBotUsername').value = channel.botUsername || channel.name || '';
    }
    document.getElementById('inputLink').value = (channel.link || '').replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '');
    document.getElementById('inputBotToken').value = channel.botToken || '';
    document.getElementById('inputPixelId').value = channel.pixelId || '';
    document.getElementById('inputAccessToken').value = channel.accessToken || '';
  } else {
    if (title) title.textContent = 'Add Telegram Account / Agent';
    document.getElementById('inputTag').value = '';
    document.getElementById('inputTag').disabled = false;
    document.getElementById('inputName').value = '';
    if (document.getElementById('inputBotUsername')) {
      document.getElementById('inputBotUsername').value = '';
    }
    document.getElementById('inputLink').value = '';
    document.getElementById('inputBotToken').value = '';
    document.getElementById('inputPixelId').value = '';
    document.getElementById('inputAccessToken').value = '';
  }

  modal.classList.add('active');
};

window.editChannel = function(tag) {
  const ch = allChannels.find(c => c.tag === tag);
  if (ch) openChannelModal(ch);
};

window.deleteChannel = async function(tag) {
  if (!confirm(`Are you sure you want to delete account "${tag}"?`)) return;

  try {
    const res = await fetch(`/api/channels/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      await loadChannels();
    } else {
      alert('Failed to delete: ' + (json.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error deleting account: ' + err.message);
  }
};

async function handleSaveChannel(e) {
  e.preventDefault();

  const tag = document.getElementById('inputTag')?.value.trim();
  const name = document.getElementById('inputName')?.value.trim();
  const botUser = document.getElementById('inputBotUsername')?.value.replace(/^@/, '').trim();
  const link = document.getElementById('inputLink')?.value.trim();

  if (!tag || !link) {
    alert('Please fill in both Campaign Tag and Telegram Username.');
    return;
  }

  const payload = {
    tag: tag,
    name: name || tag,
    botUsername: botUser || '',
    link: link,
    botToken: document.getElementById('inputBotToken')?.value.trim() || '',
    pixelId: document.getElementById('inputPixelId')?.value.trim() || '',
    accessToken: document.getElementById('inputAccessToken')?.value.trim() || ''
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
