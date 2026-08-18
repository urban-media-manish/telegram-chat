const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// ─── MongoDB Connection ───────────────────────────────────────────────────────
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('⚠️ MONGODB_URI not set. Using JSON file fallback.');
    return;
  }
  try {
    await mongoose.connect(uri, { dbName: 'teletrack' });
    isConnected = true;
    console.log('✅ MongoDB Atlas connected successfully!');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
  }
}

connectDB();

// ─── Schemas ─────────────────────────────────────────────────────────────────
const ChannelSchema = new mongoose.Schema({
  tag: { type: String, required: true, unique: true },
  name: String,
  botUsername: { type: String, default: '' },
  link: { type: String, default: '' },
  buttonText: String,
  welcomeMessage: String,
  pixelId: { type: String, default: '' },
  accessToken: { type: String, default: '' },
  botToken: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  username: { type: String, default: '' },
  languageCode: { type: String, default: 'en' },
  channelTag: { type: String, default: 'default' },
  channelName: { type: String, default: 'Default / Master' },
  rawParam: { type: String, default: '' },
  capiStatus: { type: String, default: 'pending' },
  capiTraceId: { type: String, default: '' },
  capiError: { type: String, default: null },
  lastActiveAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  userId: String,
  userChatId: mongoose.Schema.Types.Mixed,
  sender: String,
  userName: { type: String, default: '' },
  userUsername: { type: String, default: '' },
  text: { type: String, default: '' },
  type: { type: String, default: 'text' },
  botToken: { type: String, default: '' },
  channelTag: { type: String, default: 'default' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const AdminSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  adminChatId: { type: String, default: null },
  adminUsername: { type: String, default: null },
  isForum: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

const TopicSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  threadId: mongoose.Schema.Types.Mixed,
  userChatId: mongoose.Schema.Types.Mixed,
  userName: { type: String, default: '' },
  userUsername: { type: String, default: '' },
  botToken: { type: String, default: '' },
  channelTag: { type: String, default: 'default' },
  updatedAt: { type: Date, default: Date.now }
});

const Channel = mongoose.models.Channel || mongoose.model('Channel', ChannelSchema);
const Lead = mongoose.models.Lead || mongoose.model('Lead', LeadSchema);
const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);
const Topic = mongoose.models.Topic || mongoose.model('Topic', TopicSchema);

// ─── JSON Fallback ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const TOPICS_FILE = path.join(DATA_DIR, 'topics.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJsonFile(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || JSON.stringify(defaultValue));
  } catch (err) {
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

// ─── In-Memory Reply Map ──────────────────────────────────────────────────────
const replyMap = new Map();

// ─── DB Object ───────────────────────────────────────────────────────────────
const db = {

  getAdminConfig() {
    const config = readJsonFile(ADMIN_FILE, { adminChatId: null, adminUsername: null, isForum: false });
    if (!config.adminChatId && process.env.ADMIN_CHAT_ID) config.adminChatId = process.env.ADMIN_CHAT_ID;
    if (isConnected) {
      Admin.findOne({ key: 'main' }).then(admin => {
        if (admin && admin.adminChatId) writeJsonFile(ADMIN_FILE, admin.toObject());
      }).catch(() => {});
    }
    return config;
  },

  async setAdminChatId(chatId, username = '', isForum = false) {
    await connectDB();
    const data = {
      adminChatId: String(chatId),
      adminUsername: username,
      isForum: isForum || String(chatId).startsWith('-100'),
      updatedAt: new Date()
    };
    if (isConnected) {
      await Admin.findOneAndUpdate({ key: 'main' }, data, { upsert: true, returnDocument: 'after' });
    }
    writeJsonFile(ADMIN_FILE, { ...data, key: 'main' });
    return data;
  },

  getUserTopic(userId) {
    const topics = readJsonFile(TOPICS_FILE, {});
    return topics[String(userId)] || null;
  },

  getUserByTopic(threadId) {
    const topics = readJsonFile(TOPICS_FILE, {});
    for (const [userId, data] of Object.entries(topics)) {
      if (String(data.threadId) === String(threadId)) return { userId, ...data };
    }
    return null;
  },

  async saveUserTopic(userId, data) {
    await connectDB();
    const record = {
      userId: String(userId),
      threadId: data.threadId,
      userChatId: data.userChatId,
      userName: data.userName || '',
      userUsername: data.userUsername || '',
      botToken: data.botToken || '',
      channelTag: data.channelTag || 'default',
      updatedAt: new Date()
    };
    if (isConnected) {
      await Topic.findOneAndUpdate({ userId: String(userId) }, record, { upsert: true, returnDocument: 'after' });
    }
    const topics = readJsonFile(TOPICS_FILE, {});
    topics[String(userId)] = record;
    writeJsonFile(TOPICS_FILE, topics);
    return record;
  },

  saveReplyMapping(adminMsgId, data) {
    replyMap.set(String(adminMsgId), data);
    if (replyMap.size > 2000) {
      const firstKey = replyMap.keys().next().value;
      replyMap.delete(firstKey);
    }
  },

  getReplyMapping(adminMsgId) {
    return replyMap.get(String(adminMsgId)) || null;
  },

  getChannels() {
    const jsonChannels = readJsonFile(CHANNELS_FILE, []);
    if (isConnected) {
      Channel.find({}).then(dbChannels => {
        if (dbChannels.length > 0) {
          writeJsonFile(CHANNELS_FILE, dbChannels.map(c => c.toObject()));
        } else if (jsonChannels.length > 0) {
          // Seed MongoDB from JSON if empty
          Promise.all(jsonChannels.map(ch =>
            Channel.findOneAndUpdate({ tag: ch.tag }, ch, { upsert: true, returnDocument: 'after' })
          )).catch(() => {});
        }
      }).catch(() => {});
    }
    return jsonChannels;
  },

  async getChannelsAsync() {
    await connectDB();
    if (isConnected) {
      let dbChannels = await Channel.find({});
      if (dbChannels.length === 0) {
        // Seed from JSON
        const jsonChannels = readJsonFile(CHANNELS_FILE, []);
        if (jsonChannels.length > 0) {
          for (const ch of jsonChannels) {
            await Channel.findOneAndUpdate({ tag: ch.tag }, ch, { upsert: true, returnDocument: 'after' });
          }
          dbChannels = await Channel.find({});
        }
      }
      const list = dbChannels.map(c => c.toObject());
      if (list.length > 0) writeJsonFile(CHANNELS_FILE, list);
      return list;
    }
    return readJsonFile(CHANNELS_FILE, []);
  },

  getChannelByTag(tag) {
    if (!tag) return null;
    const channels = this.getChannels();
    return channels.find(c => c.tag.toLowerCase() === tag.trim().toLowerCase()) || null;
  },

  async saveChannel(channelData) {
    await connectDB();
    const cleanTag = channelData.tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const record = {
      tag: cleanTag,
      name: channelData.name || `Channel ${cleanTag}`,
      botUsername: channelData.botUsername !== undefined ? channelData.botUsername : '',
      link: channelData.link || 'https://t.me/',
      buttonText: channelData.buttonText || `Join ${channelData.name || cleanTag}`,
      welcomeMessage: channelData.welcomeMessage || 'Welcome! Send a message here to chat directly:',
      pixelId: channelData.pixelId ? channelData.pixelId.trim() : '',
      accessToken: channelData.accessToken ? channelData.accessToken.trim() : '',
      botToken: channelData.botToken ? channelData.botToken.trim() : '',
      updatedAt: new Date()
    };

    if (isConnected) {
      const ch = await Channel.findOneAndUpdate({ tag: cleanTag }, record, { upsert: true, returnDocument: 'after' });
      const all = await Channel.find({});
      writeJsonFile(CHANNELS_FILE, all.map(c => c.toObject()));
      return ch.toObject();
    }

    const channels = readJsonFile(CHANNELS_FILE, []);
    const idx = channels.findIndex(c => c.tag.toLowerCase() === cleanTag);
    if (idx >= 0) {
      channels[idx] = { ...channels[idx], ...record };
      writeJsonFile(CHANNELS_FILE, channels);
      return channels[idx];
    }
    record.createdAt = new Date().toISOString();
    channels.push(record);
    writeJsonFile(CHANNELS_FILE, channels);
    return record;
  },

  async deleteChannel(tag) {
    await connectDB();
    if (isConnected) {
      await Channel.deleteOne({ tag: tag.trim().toLowerCase() });
      const all = await Channel.find({});
      writeJsonFile(CHANNELS_FILE, all.map(c => c.toObject()));
    } else {
      const channels = readJsonFile(CHANNELS_FILE, []);
      writeJsonFile(CHANNELS_FILE, channels.filter(c => c.tag.toLowerCase() !== tag.trim().toLowerCase()));
    }
    return true;
  },

  getLeads(limit = 100) {
    if (isConnected) {
      return readJsonFile(LEADS_FILE, []).slice(0, limit);
    }
    const leads = readJsonFile(LEADS_FILE, []);
    const uniqueMap = new Map();
    for (let i = leads.length - 1; i >= 0; i--) {
      const l = leads[i];
      const uid = String(l.userId);
      if (!uniqueMap.has(uid)) uniqueMap.set(uid, l);
    }
    const list = Array.from(uniqueMap.values());
    list.sort((a, b) => new Date(b.lastActiveAt || b.createdAt) - new Date(a.lastActiveAt || a.createdAt));
    return list.slice(0, limit);
  },

  async getLeadsAsync(limit = 100) {
    await connectDB();
    if (isConnected) {
      const leads = await Lead.find({}).sort({ lastActiveAt: -1 }).limit(limit);
      const list = leads.map(l => l.toObject());
      writeJsonFile(LEADS_FILE, list);
      return list;
    }
    return this.getLeads(limit);
  },

  async addLead(leadData) {
    await connectDB();
    const uid = String(leadData.userId);
    const now = new Date();

    if (isConnected) {
      // Build complete update - all fields in $set to avoid $setOnInsert conflict
      const update = {
        firstName: leadData.firstName || '',
        lastName: leadData.lastName || '',
        username: leadData.username || '',
        languageCode: leadData.languageCode || 'en',
        lastActiveAt: now,
        channelTag: leadData.channelTag || 'default',
        channelName: leadData.channelName || 'Default / Master',
        rawParam: leadData.rawParam || '',
        capiStatus: leadData.capiStatus || 'pending',
        capiTraceId: leadData.capiTraceId || '',
        capiError: leadData.capiError || null
      };
      const lead = await Lead.findOneAndUpdate(
        { userId: uid },
        {
          $set: update,
          $setOnInsert: { createdAt: now }
        },
        { upsert: true, returnDocument: 'after' }
      );
      const all = await Lead.find({}).sort({ lastActiveAt: -1 });
      writeJsonFile(LEADS_FILE, all.map(l => l.toObject()));
      return lead.toObject();
    }

    const leads = readJsonFile(LEADS_FILE, []);
    const existingIndex = leads.findIndex(l => String(l.userId) === uid);
    if (existingIndex !== -1) {
      const existing = leads[existingIndex];
      existing.firstName = leadData.firstName || existing.firstName;
      existing.lastName = leadData.lastName || existing.lastName;
      existing.username = leadData.username || existing.username;
      if (leadData.channelTag && leadData.channelTag !== 'default') {
        existing.channelTag = leadData.channelTag;
        existing.channelName = leadData.channelName || existing.channelName;
        existing.rawParam = leadData.rawParam || existing.rawParam;
      }
      if (leadData.capiStatus && leadData.capiStatus !== 'skipped') {
        existing.capiStatus = leadData.capiStatus;
        existing.capiTraceId = leadData.capiTraceId || existing.capiTraceId;
        existing.capiError = leadData.capiError;
      }
      existing.lastActiveAt = now.toISOString();
      writeJsonFile(LEADS_FILE, leads);
      return existing;
    }

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
      lastActiveAt: now.toISOString(),
      createdAt: now.toISOString()
    };
    leads.push(newLead);
    writeJsonFile(LEADS_FILE, leads);
    return newLead;
  },

  async saveMessage(msgData) {
    await connectDB();
    const record = {
      userId: String(msgData.userId),
      userChatId: msgData.userChatId,
      sender: msgData.sender,
      userName: msgData.userName || '',
      userUsername: msgData.userUsername || '',
      text: msgData.text || '',
      type: msgData.type || 'text',
      botToken: msgData.botToken || '',
      channelTag: msgData.channelTag || 'default',
      read: false,
      createdAt: new Date()
    };
    if (isConnected) {
      const msg = await Message.create(record);
      const recent = await Message.find({}).sort({ createdAt: -1 }).limit(500);
      writeJsonFile(MESSAGES_FILE, recent.map(m => m.toObject()).reverse());
      return msg.toObject();
    }
    const messages = readJsonFile(MESSAGES_FILE, []);
    record.id = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    messages.push(record);
    if (messages.length > 5000) messages.splice(0, messages.length - 5000);
    writeJsonFile(MESSAGES_FILE, messages);
    return record;
  },

  async getMessagesByUser(userId, limit = 100) {
    await connectDB();
    if (isConnected) {
      const msgs = await Message.find({ userId: String(userId) }).sort({ createdAt: 1 }).limit(limit);
      return msgs.map(m => m.toObject());
    }
    const messages = readJsonFile(MESSAGES_FILE, []);
    return messages.filter(m => String(m.userId) === String(userId)).slice(-limit);
  },

  async getConversations() {
    await connectDB();
    const admin = this.getAdminConfig();
    const adminId = admin.adminChatId ? String(admin.adminChatId) : null;
    const EXCLUDE = new Set(['5212375937', '-1004309264544', adminId].filter(Boolean));

    let leads = [], messages = [];
    if (isConnected) {
      leads = (await Lead.find({}).sort({ lastActiveAt: -1 })).map(l => l.toObject());
      messages = (await Message.find({}).sort({ createdAt: 1 })).map(m => m.toObject());
    } else {
      leads = readJsonFile(LEADS_FILE, []);
      messages = readJsonFile(MESSAGES_FILE, []);
    }

    const userMap = new Map();

    for (const lead of leads) {
      const uid = String(lead.userId);
      if (EXCLUDE.has(uid)) continue;
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

    for (const msg of messages) {
      const uid = String(msg.userId);
      if (EXCLUDE.has(uid)) continue;
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
      if (msg.sender === 'user') {
        if (msg.userName && msg.userName !== 'Admin') existing.userName = msg.userName;
        if (msg.userUsername) existing.userUsername = msg.userUsername;
      }
      if (msg.botToken) existing.botToken = msg.botToken;
      if (msg.userChatId) existing.userChatId = msg.userChatId;
      if (msg.sender === 'user' && !msg.read) existing.unreadCount = (existing.unreadCount || 0) + 1;
      userMap.set(uid, existing);
    }

    return Array.from(userMap.values())
      .filter(c => c.userName !== 'Admin' && c.userName !== 'Admin (Web Panel)')
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  },

  async markMessagesRead(userId) {
    await connectDB();
    if (isConnected) {
      await Message.updateMany({ userId: String(userId), sender: 'user', read: false }, { read: true });
    }
    const messages = readJsonFile(MESSAGES_FILE, []);
    let changed = false;
    for (const msg of messages) {
      if (String(msg.userId) === String(userId) && msg.sender === 'user' && !msg.read) {
        msg.read = true;
        changed = true;
      }
    }
    if (changed) writeJsonFile(MESSAGES_FILE, messages);
    return true;
  },

  getStats() {
    const leads = readJsonFile(LEADS_FILE, []);
    const channels = this.getChannels();
    const admin = this.getAdminConfig();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let todayLeads = 0, successfulCapi = 0, failedCapi = 0;
    const channelCounts = {};
    for (const lead of leads) {
      const time = new Date(lead.createdAt).getTime();
      if (time >= startOfToday) todayLeads++;
      if (lead.capiStatus === 'success') successfulCapi++;
      if (lead.capiStatus === 'failed') failedCapi++;
      const ch = lead.channelTag || 'other';
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
    }
    return { totalLeads: leads.length, todayLeads, successfulCapi, failedCapi, totalChannels: channels.length, channelCounts, adminConnected: !!admin.adminChatId };
  },

  async getStatsAsync() {
    await connectDB();
    if (isConnected) {
      const leads = (await Lead.find({})).map(l => l.toObject());
      writeJsonFile(LEADS_FILE, leads);
      const channels = this.getChannels();
      const admin = this.getAdminConfig();
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      let todayLeads = 0, successfulCapi = 0, failedCapi = 0;
      const channelCounts = {};
      for (const lead of leads) {
        const time = new Date(lead.createdAt).getTime();
        if (time >= startOfToday) todayLeads++;
        if (lead.capiStatus === 'success') successfulCapi++;
        if (lead.capiStatus === 'failed') failedCapi++;
        const ch = lead.channelTag || 'other';
        channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      }
      return { totalLeads: leads.length, todayLeads, successfulCapi, failedCapi, totalChannels: channels.length, channelCounts, adminConnected: !!admin.adminChatId };
    }
    return this.getStats();
  }
};

module.exports = db;
