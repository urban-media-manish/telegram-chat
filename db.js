const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const TOPICS_FILE = path.join(DATA_DIR, 'topics.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory mapping of Admin Message ID -> User Target
const replyMap = new Map();

// Default channels template
const DEFAULT_CHANNELS = [
  {
    tag: 'cric1',
    name: 'Cricket Channel 1 (VIP Predictions)',
    link: 'https://t.me/your_cricket_channel_1',
    buttonText: '🏏 Join Cricket Channel 1 (VIP)',
    welcomeMessage: '🏏 **Welcome to Cricket VIP Predictions!**\n\n🔥 Today\'s Toss & Match Winner analysis is ready.\n\n👇 You can send your message directly here to chat with us:',
    pixelId: '',
    accessToken: '',
    botToken: '',
    createdAt: new Date().toISOString()
  },
  {
    tag: 'cric2',
    name: 'Cricket Channel 2 (Toss & Session)',
    link: 'https://t.me/your_cricket_channel_2',
    buttonText: '⚡ Join Toss & Session VIP',
    welcomeMessage: '⚡ **Welcome to Toss & Session Kings!**\n\n🎯 100% Accurate Toss Updates & Live Sessions.\n\n👇 Send your question or message directly here:',
    pixelId: '',
    accessToken: '',
    botToken: '',
    createdAt: new Date().toISOString()
  },
  {
    tag: 'cric3',
    name: 'Cricket Channel 3 (Jackpot Match)',
    link: 'https://t.me/your_cricket_channel_3',
    buttonText: '🏆 Join Jackpot Cricket Club',
    welcomeMessage: '🏆 **Welcome to Jackpot Match Special!**\n\n💰 High profit match reports and live tips.\n\n👇 Send a message right here to talk to our expert team:',
    pixelId: '',
    accessToken: '',
    botToken: '',
    createdAt: new Date().toISOString()
  }
];

function readJsonFile(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

// Initialize files if empty
if (!fs.existsSync(CHANNELS_FILE)) writeJsonFile(CHANNELS_FILE, DEFAULT_CHANNELS);
if (!fs.existsSync(LEADS_FILE)) writeJsonFile(LEADS_FILE, []);
if (!fs.existsSync(MESSAGES_FILE)) writeJsonFile(MESSAGES_FILE, []);
if (!fs.existsSync(ADMIN_FILE)) writeJsonFile(ADMIN_FILE, { adminChatId: null, adminUsername: null, isForum: false });
if (!fs.existsSync(TOPICS_FILE)) writeJsonFile(TOPICS_FILE, {});

const db = {
  // Admin Configuration
  getAdminConfig() {
    const config = readJsonFile(ADMIN_FILE, { adminChatId: null, adminUsername: null, isForum: false });
    if (!config.adminChatId && process.env.ADMIN_CHAT_ID) {
      config.adminChatId = process.env.ADMIN_CHAT_ID;
    }
    return config;
  },

  setAdminChatId(chatId, username = '', isForum = false) {
    const config = {
      adminChatId: String(chatId),
      adminUsername: username,
      isForum: isForum || String(chatId).startsWith('-100'),
      updatedAt: new Date().toISOString()
    };
    writeJsonFile(ADMIN_FILE, config);
    return config;
  },

  // Forum Topics Management (1 Topic per User)
  getUserTopic(userId) {
    const topics = readJsonFile(TOPICS_FILE, {});
    return topics[String(userId)] || null;
  },

  getUserByTopic(threadId) {
    const topics = readJsonFile(TOPICS_FILE, {});
    for (const [userId, data] of Object.entries(topics)) {
      if (String(data.threadId) === String(threadId)) {
        return { userId, ...data };
      }
    }
    return null;
  },

  saveUserTopic(userId, data) {
    const topics = readJsonFile(TOPICS_FILE, {});
    topics[String(userId)] = {
      threadId: data.threadId,
      userChatId: data.userChatId,
      userName: data.userName || '',
      userUsername: data.userUsername || '',
      botToken: data.botToken || '',
      channelTag: data.channelTag || 'default',
      updatedAt: new Date().toISOString()
    };
    writeJsonFile(TOPICS_FILE, topics);
    return topics[String(userId)];
  },

  // Reply Mapping (Admin Forward Msg ID -> User Chat ID & Bot Token)
  saveReplyMapping(adminMsgId, data) {
    replyMap.set(String(adminMsgId), data);
    // Keep map size reasonable
    if (replyMap.size > 2000) {
      const firstKey = replyMap.keys().next().value;
      replyMap.delete(firstKey);
    }
  },

  getReplyMapping(adminMsgId) {
    return replyMap.get(String(adminMsgId)) || null;
  },

  // Channels
  getChannels() {
    return readJsonFile(CHANNELS_FILE, DEFAULT_CHANNELS);
  },

  getChannelByTag(tag) {
    if (!tag) return null;
    const channels = this.getChannels();
    return channels.find(c => c.tag.toLowerCase() === tag.trim().toLowerCase()) || null;
  },

  saveChannel(channelData) {
    const channels = this.getChannels();
    const cleanTag = channelData.tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    
    const existingIndex = channels.findIndex(c => c.tag.toLowerCase() === cleanTag);
    const updatedChannel = {
      tag: cleanTag,
      name: channelData.name || `Channel ${cleanTag}`,
      link: channelData.link || 'https://t.me/',
      buttonText: channelData.buttonText || `Join ${channelData.name || cleanTag}`,
      welcomeMessage: channelData.welcomeMessage || `Welcome! Send a message here to chat directly:`,
      pixelId: channelData.pixelId ? channelData.pixelId.trim() : '',
      accessToken: channelData.accessToken ? channelData.accessToken.trim() : '',
      botToken: channelData.botToken ? channelData.botToken.trim() : '',
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      channels[existingIndex] = { ...channels[existingIndex], ...updatedChannel };
    } else {
      updatedChannel.createdAt = new Date().toISOString();
      channels.push(updatedChannel);
    }

    writeJsonFile(CHANNELS_FILE, channels);
    return updatedChannel;
  },

  deleteChannel(tag) {
    const channels = this.getChannels();
    const filtered = channels.filter(c => c.tag.toLowerCase() !== tag.trim().toLowerCase());
    writeJsonFile(CHANNELS_FILE, filtered);
    return true;
  },

  // Leads
  getLeads(limit = 100) {
    const leads = readJsonFile(LEADS_FILE, []);
    return leads.reverse().slice(0, limit);
  },

  addLead(leadData) {
    const leads = readJsonFile(LEADS_FILE, []);
    const newLead = {
      id: 'lead_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      userId: leadData.userId,
      firstName: leadData.firstName || '',
      lastName: leadData.lastName || '',
      username: leadData.username || '',
      languageCode: leadData.languageCode || 'en',
      channelTag: leadData.channelTag || 'default',
      channelName: leadData.channelName || 'Default / Master',
      rawParam: leadData.rawParam || '',
      capiStatus: leadData.capiStatus || 'pending',
      capiTraceId: leadData.capiTraceId || '',
      capiError: leadData.capiError || null,
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);
    writeJsonFile(LEADS_FILE, leads);
    return newLead;
  },

  // Chat Messages
  saveMessage(msgData) {
    const messages = readJsonFile(MESSAGES_FILE, []);
    const record = {
      id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      userId: msgData.userId,
      userChatId: msgData.userChatId,
      sender: msgData.sender, // 'user' or 'admin'
      userName: msgData.userName || '',
      userUsername: msgData.userUsername || '',
      text: msgData.text || '',
      type: msgData.type || 'text',
      botToken: msgData.botToken || '',
      channelTag: msgData.channelTag || 'default',
      createdAt: new Date().toISOString()
    };
    messages.push(record);
    // Keep max 5000 messages in file
    if (messages.length > 5000) {
      messages.splice(0, messages.length - 5000);
    }
    writeJsonFile(MESSAGES_FILE, messages);
    return record;
  },

  getMessagesByUser(userId, limit = 100) {
    const messages = readJsonFile(MESSAGES_FILE, []);
    return messages
      .filter(m => String(m.userId) === String(userId))
      .slice(-limit);
  },

  getConversations() {
    const messages = readJsonFile(MESSAGES_FILE, []);
    const leads = readJsonFile(LEADS_FILE, []);
    const admin = this.getAdminConfig();
    const adminId = admin.adminChatId ? String(admin.adminChatId) : null;

    const userMap = new Map();

    // Index from leads first
    for (const lead of leads) {
      const uid = String(lead.userId);
      // Exclude Admin from customer list
      if (adminId && (uid === adminId || uid === '5212375937' || uid === '-1004309264544')) {
        continue;
      }

      const displayName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || (lead.username ? `@${lead.username}` : `User ${lead.userId}`);

      userMap.set(uid, {
        userId: lead.userId,
        userChatId: lead.userId,
        userName: displayName,
        userUsername: lead.username || '',
        channelTag: lead.channelTag || 'default',
        channelName: lead.channelName || 'Default',
        lastMessage: 'Started bot',
        lastMessageSender: 'system',
        lastMessageTime: lead.createdAt,
        unreadCount: 0,
        botToken: ''
      });
    }

    // Overlay messages
    for (const msg of messages) {
      const uid = String(msg.userId);
      // Exclude Admin from customer list
      if (adminId && (uid === adminId || uid === '5212375937' || uid === '-1004309264544')) {
        continue;
      }

      const existing = userMap.get(uid) || {
        userId: msg.userId,
        userChatId: msg.userChatId || msg.userId,
        userName: msg.userName || (msg.userUsername ? `@${msg.userUsername}` : `User ${msg.userId}`),
        userUsername: msg.userUsername || '',
        channelTag: msg.channelTag || 'default',
        channelName: 'Direct Chat',
        lastMessage: '',
        lastMessageSender: '',
        lastMessageTime: msg.createdAt,
        unreadCount: 0,
        botToken: msg.botToken || ''
      };

      existing.lastMessage = msg.text || '[Media]';
      existing.lastMessageSender = msg.sender;
      existing.lastMessageTime = msg.createdAt;

      // Only update userName and userUsername if message is from the customer
      if (msg.sender === 'user') {
        if (msg.userName && msg.userName !== 'Admin' && msg.userName !== 'Admin (Web Panel)') {
          existing.userName = msg.userName;
        }
        if (msg.userUsername) {
          existing.userUsername = msg.userUsername;
        }
      }

      if (msg.botToken) existing.botToken = msg.botToken;
      if (msg.userChatId) existing.userChatId = msg.userChatId;

      if (msg.sender === 'user' && !msg.read) {
        existing.unreadCount = (existing.unreadCount || 0) + 1;
      }

      userMap.set(uid, existing);
    }

    return Array.from(userMap.values())
      .filter(c => c.userName !== 'Admin' && c.userName !== 'Admin (Web Panel)')
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  },

  markMessagesRead(userId) {
    const messages = readJsonFile(MESSAGES_FILE, []);
    let changed = false;
    for (const msg of messages) {
      if (String(msg.userId) === String(userId) && msg.sender === 'user' && !msg.read) {
        msg.read = true;
        changed = true;
      }
    }
    if (changed) {
      writeJsonFile(MESSAGES_FILE, messages);
    }
    return true;
  },

  // Stats
  getStats() {
    const leads = readJsonFile(LEADS_FILE, []);
    const channels = this.getChannels();
    const admin = this.getAdminConfig();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

    let todayLeads = 0;
    let weekLeads = 0;
    let successfulCapi = 0;
    let failedCapi = 0;

    const channelCounts = {};

    for (const lead of leads) {
      const time = new Date(lead.createdAt).getTime();
      if (time >= startOfToday) todayLeads++;
      if (time >= sevenDaysAgo) weekLeads++;

      if (lead.capiStatus === 'success') successfulCapi++;
      if (lead.capiStatus === 'failed') failedCapi++;

      const ch = lead.channelTag || 'other';
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
    }

    return {
      totalLeads: leads.length,
      todayLeads,
      weekLeads,
      successfulCapi,
      failedCapi,
      totalChannels: channels.length,
      channelCounts,
      adminConnected: !!admin.adminChatId
    };
  }
};

module.exports = db;
