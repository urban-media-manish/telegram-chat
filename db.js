const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const geoip = require('geoip-lite');

const STATE_NAMES = {
  'MH': 'Maharashtra', 'DL': 'Delhi', 'UP': 'Uttar Pradesh', 'GJ': 'Gujarat',
  'RJ': 'Rajasthan', 'KA': 'Karnataka', 'TN': 'Tamil Nadu', 'WB': 'West Bengal',
  'PB': 'Punjab', 'HR': 'Haryana', 'MP': 'Madhya Pradesh', 'BR': 'Bihar',
  'TG': 'Telangana', 'AP': 'Andhra Pradesh', 'KL': 'Kerala', 'OR': 'Odisha',
  'JH': 'Jharkhand', 'AS': 'Assam', 'UT': 'Uttarakhand', 'HP': 'Himachal Pradesh',
  'GA': 'Goa', 'CH': 'Chandigarh', 'JK': 'Jammu & Kashmir'
};

function resolveGeo(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') {
    return { country: 'India', state: '', city: '' };
  }
  try {
    const cleanIp = ip.split(',')[0].trim();
    const geo = geoip.lookup(cleanIp);
    if (!geo) return { country: 'India', state: '', city: '' };
    const state = STATE_NAMES[geo.region] || geo.region || '';
    const city = geo.city || '';
    const country = geo.country === 'IN' ? 'India' : (geo.country || 'India');
    return { country, state, city };
  } catch (e) {
    return { country: 'India', state: '', city: '' };
  }
}

// ─── MongoDB Connection ───────────────────────────────────────────────────────
let isConnected = false;
let connectionPromise = null;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return true;
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;

  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await mongoose.connect(uri, {
        dbName: 'teletrack',
        serverSelectionTimeoutMS: 4000,
        connectTimeoutMS: 4000,
        socketTimeoutMS: 8000
      });
      isConnected = true;
      console.log('✅ MongoDB Atlas connected successfully!');
      try {
        await Lead.collection.dropIndex('userId_1');
      } catch (err) {}
      return true;
    } catch (err) {
      console.error('⚠️ MongoDB connection attempt failed (using JSON fallback):', err.message);
      isConnected = false;
      return false;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

// Background auto-connect without blocking
connectDB().catch(() => {});

// ─── Schemas ─────────────────────────────────────────────────────────────────
const ChannelSchema = new mongoose.Schema({
  tag: { type: String, required: true, unique: true },
  name: String,
  destinationType: { type: String, default: 'bot' },
  botUsername: { type: String, default: '' },
  link: { type: String, default: '' },
  buttonText: String,
  welcomeMessage: String,
  pixelId: { type: String, default: '' },
  accessToken: { type: String, default: '' },
  botToken: { type: String, default: '' },
  accessPin: { type: String, default: '1234' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  username: { type: String, default: '' },
  languageCode: { type: String, default: 'en' },
  channelTag: { type: String, default: 'default' },
  channelName: { type: String, default: 'Default / Master' },
  rawParam: { type: String, default: '' },
  joinType: { type: String, default: 'bot_start' },
  retentionStatus: { type: String, default: 'active' },
  leftAt: { type: Date, default: null },
  capiStatus: { type: String, default: 'pending' },
  capiTraceId: { type: String, default: '' },
  capiError: { type: String, default: null },
  platform: { type: String, default: 'Facebook' },
  placement: { type: String, default: 'Feed' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  country: { type: String, default: 'India' },
  lastActiveAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
LeadSchema.index({ userId: 1, channelTag: 1 }, { unique: true });

const MessageSchema = new mongoose.Schema({
  userId: String,
  userChatId: mongoose.Schema.Types.Mixed,
  sender: String,
  userName: { type: String, default: '' },
  userUsername: { type: String, default: '' },
  text: { type: String, default: '' },
  type: { type: String, default: 'text' },
  mediaUrl: { type: String, default: '' },
  mediaType: { type: String, default: '' },
  fileId: { type: String, default: '' },
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

const ClickLogSchema = new mongoose.Schema({
  channelTag: { type: String, default: 'default' },
  adName: { type: String, default: '' },
  adId: { type: String, default: '' },
  campaignName: { type: String, default: '' },
  fbclid: { type: String, default: '' },
  device: { type: String, default: 'mobile' },
  platform: { type: String, default: 'Facebook' },
  placement: { type: String, default: 'Feed' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  country: { type: String, default: 'India' },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const ClickLog = mongoose.models.ClickLog || mongoose.model('ClickLog', ClickLogSchema);

const FraudLogSchema = new mongoose.Schema({
  channelTag: { type: String, default: 'default' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  reason: { type: String, default: '' },
  score: { type: Number, default: 90 },
  createdAt: { type: Date, default: Date.now }
});
const FraudLog = mongoose.models.FraudLog || mongoose.model('FraudLog', FraudLogSchema);

// ─── JSON Fallback ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.json');
const FRAUD_FILE = path.join(DATA_DIR, 'fraud.json');
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

// ─── Time Window Resolver for Date-Wise Analytics ──────────────────────────
function resolveTimeWindow(range, startDate, endDate) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000 - 1;

  if (range === 'today') {
    return { start: startOfToday, end: endOfToday, label: 'Today' };
  } else if (range === 'yesterday') {
    const startOfYest = startOfToday - 86400000;
    const endOfYest = startOfToday - 1;
    return { start: startOfYest, end: endOfYest, label: 'Yesterday' };
  } else if (range === '7d') {
    const start7d = startOfToday - 6 * 86400000;
    return { start: start7d, end: endOfToday, label: 'Last 7 Days' };
  } else if (range === '30d') {
    const start30d = startOfToday - 29 * 86400000;
    return { start: start30d, end: endOfToday, label: 'Last 30 Days' };
  } else if (range === 'custom' && (startDate || endDate)) {
    const s = startDate ? new Date(startDate).getTime() : 0;
    const e = endDate ? (new Date(endDate).getTime() + 86400000 - 1) : Date.now();
    return { start: s, end: e, label: 'Custom Range' };
  }
  return { start: 0, end: Infinity, label: 'All Time' };
}

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
    const data = {
      adminChatId: String(chatId),
      adminUsername: username,
      isForum: isForum || String(chatId).startsWith('-100'),
      updatedAt: new Date()
    };
    try {
      if (await connectDB()) {
        await Admin.findOneAndUpdate({ key: 'main' }, data, { upsert: true, returnDocument: 'after' });
      }
    } catch (e) {}
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
    try {
      if (await connectDB()) {
        await Topic.findOneAndUpdate({ userId: String(userId) }, record, { upsert: true, returnDocument: 'after' });
      }
    } catch (e) {}
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
    if (cachedChannels && cachedChannels.length > 0) return cachedChannels;
    const jsonChannels = readJsonFile(CHANNELS_FILE, []);
    cachedChannels = jsonChannels;
    if (isConnected) {
      Channel.find({}).then(dbChannels => {
        if (dbChannels.length > 0) {
          cachedChannels = dbChannels.map(c => c.toObject());
          writeJsonFile(CHANNELS_FILE, cachedChannels);
        }
      }).catch(() => {});
    }
    return jsonChannels;
  },

  async getChannelsAsync() {
    try {
      if (await connectDB()) {
        const dbChannels = await Channel.find({}).lean();
        if (dbChannels.length > 0) {
          cachedChannels = dbChannels;
          writeJsonFile(CHANNELS_FILE, dbChannels);
          return dbChannels;
        }
      }
    } catch (e) {
      console.warn('⚠️ getChannelsAsync fallback to JSON:', e.message);
    }
    const jsonChannels = readJsonFile(CHANNELS_FILE, []);
    cachedChannels = jsonChannels;
    return jsonChannels;
  },

  getChannelByTag(tag) {
    if (!tag) return null;
    const channels = this.getChannels();
    return channels.find(c => c.tag.toLowerCase() === tag.trim().toLowerCase()) || null;
  },

  async saveChannel(channelData) {
    cachedChannels = null;
    const cleanTag = channelData.tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const record = {
      tag: cleanTag,
      name: channelData.name || `Channel ${cleanTag}`,
      destinationType: channelData.destinationType || (channelData.link && (channelData.link.includes('t.me/+') || channelData.link.includes('t.me/joinchat')) ? 'channel' : 'bot'),
      botUsername: channelData.botUsername !== undefined ? channelData.botUsername : '',
      link: channelData.link || 'https://t.me/',
      buttonText: channelData.buttonText || `Join ${channelData.name || cleanTag}`,
      welcomeMessage: channelData.welcomeMessage || 'Welcome! Send a message here to chat directly:',
      pixelId: channelData.pixelId ? channelData.pixelId.trim() : '',
      accessToken: channelData.accessToken ? channelData.accessToken.trim() : '',
      botToken: channelData.botToken ? channelData.botToken.trim() : '',
      accessPin: channelData.accessPin ? String(channelData.accessPin).trim() : '1234',
      updatedAt: new Date()
    };

    try {
      if (await connectDB()) {
        const ch = await Channel.findOneAndUpdate({ tag: cleanTag }, record, { upsert: true, returnDocument: 'after' });
        const all = await Channel.find({});
        const allList = all.map(c => c.toObject());
        cachedChannels = allList;
        writeJsonFile(CHANNELS_FILE, allList);
        return ch.toObject();
      }
    } catch (e) {
      console.warn('⚠️ saveChannel fallback to JSON:', e.message);
    }

    const channels = readJsonFile(CHANNELS_FILE, []);
    const idx = channels.findIndex(c => c.tag.toLowerCase() === cleanTag);
    if (idx >= 0) {
      channels[idx] = { ...channels[idx], ...record };
      cachedChannels = channels;
      writeJsonFile(CHANNELS_FILE, channels);
      return channels[idx];
    }
    record.createdAt = new Date().toISOString();
    channels.push(record);
    cachedChannels = channels;
    writeJsonFile(CHANNELS_FILE, channels);
    return record;
  },

  async deleteChannel(tag) {
    cachedChannels = null;
    try {
      if (await connectDB()) {
        await Channel.deleteOne({ tag: tag.trim().toLowerCase() });
        const all = await Channel.find({});
        const allList = all.map(c => c.toObject());
        cachedChannels = allList;
        writeJsonFile(CHANNELS_FILE, allList);
        return true;
      }
    } catch (e) {}

    const channels = readJsonFile(CHANNELS_FILE, []);
    const remaining = channels.filter(c => c.tag.toLowerCase() !== tag.trim().toLowerCase());
    cachedChannels = remaining;
    writeJsonFile(CHANNELS_FILE, remaining);
    return true;
  },

  getLeads(limit = 100, options = {}) {
    const leads = readJsonFile(LEADS_FILE, []);
    const range = options.range || 'all';
    const timeWindow = resolveTimeWindow(range, options.startDate, options.endDate);
    
    let filtered = leads;
    if (timeWindow.start > 0 || timeWindow.end < Infinity) {
      filtered = leads.filter(l => {
        const t = new Date(l.createdAt || 0).getTime();
        return t >= timeWindow.start && t <= timeWindow.end;
      });
    }
    if (options.channel && options.channel !== 'all') {
      filtered = filtered.filter(l => l.channelTag === options.channel);
    }

    const uniqueMap = new Map();
    for (let i = filtered.length - 1; i >= 0; i--) {
      const l = filtered[i];
      const uid = String(l.userId) + '_' + (l.channelTag || 'default');
      if (!uniqueMap.has(uid)) uniqueMap.set(uid, l);
    }
    const list = Array.from(uniqueMap.values());
    list.sort((a, b) => new Date(b.lastActiveAt || b.createdAt) - new Date(a.lastActiveAt || a.createdAt));
    return list.slice(0, limit);
  },

  async getLeadsAsync(limit = 100, options = {}) {
    try {
      if (await connectDB()) {
        const range = options.range || 'all';
        const timeWindow = resolveTimeWindow(range, options.startDate, options.endDate);
        const query = {};
        if (timeWindow.start > 0 || timeWindow.end < Infinity) {
          query.createdAt = { $gte: new Date(timeWindow.start), $lte: new Date(timeWindow.end) };
        }
        if (options.channel && options.channel !== 'all') {
          query.channelTag = options.channel;
        }
        const leads = await Lead.find(query).sort({ lastActiveAt: -1 }).limit(limit).lean();
        return leads;
      }
    } catch (e) {
      console.warn('⚠️ getLeadsAsync fallback to JSON:', e.message);
    }
    return this.getLeads(limit, options);
  },

  async addLead(leadData) {
    const uid = String(leadData.userId);
    const tag = leadData.channelTag || 'default';
    const now = new Date();

    try {
      if (await connectDB()) {
        const update = {
          firstName: leadData.firstName || '',
          lastName: leadData.lastName || '',
          username: leadData.username || '',
          languageCode: leadData.languageCode || 'en',
          lastActiveAt: now,
          channelTag: tag,
          channelName: leadData.channelName || 'Default / Master',
          rawParam: leadData.rawParam || '',
          joinType: leadData.joinType || 'bot_start',
          retentionStatus: leadData.retentionStatus || 'active',
          capiStatus: leadData.capiStatus || 'pending',
          capiTraceId: leadData.capiTraceId || '',
          capiError: leadData.capiError || null
        };
        const lead = await Lead.findOneAndUpdate(
          { userId: uid, channelTag: tag },
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
    } catch (e) {
      console.warn('⚠️ addLead fallback to JSON:', e.message);
    }

    const leads = readJsonFile(LEADS_FILE, []);
    const existingIndex = leads.findIndex(l => String(l.userId) === uid && (l.channelTag || 'default') === tag);
    if (existingIndex !== -1) {
      const existing = leads[existingIndex];
      existing.firstName = leadData.firstName || existing.firstName;
      existing.lastName = leadData.lastName || existing.lastName;
      existing.username = leadData.username || existing.username;
      existing.channelTag = tag;
      existing.channelName = leadData.channelName || existing.channelName;
      existing.rawParam = leadData.rawParam || existing.rawParam;
      if (leadData.joinType) existing.joinType = leadData.joinType;
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
      channelTag: tag,
      channelName: leadData.channelName || 'Default / Master',
      rawParam: leadData.rawParam || '',
      joinType: leadData.joinType || 'bot_start',
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
    const record = {
      userId: String(msgData.userId),
      userChatId: msgData.userChatId,
      sender: msgData.sender,
      userName: msgData.userName || '',
      userUsername: msgData.userUsername || '',
      text: msgData.text || '',
      type: msgData.type || 'text',
      mediaUrl: msgData.mediaUrl || '',
      mediaType: msgData.mediaType || '',
      fileId: msgData.fileId || '',
      botToken: msgData.botToken || '',
      channelTag: msgData.channelTag || 'default',
      read: false,
      createdAt: new Date()
    };

    try {
      if (await connectDB()) {
        const msg = await Message.create(record);
        const recent = await Message.find({}).sort({ createdAt: -1 }).limit(500);
        writeJsonFile(MESSAGES_FILE, recent.map(m => m.toObject()).reverse());
        return msg.toObject();
      }
    } catch (e) {
      console.warn('⚠️ saveMessage fallback to JSON:', e.message);
    }

    const messages = readJsonFile(MESSAGES_FILE, []);
    record.id = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    messages.push(record);
    if (messages.length > 5000) messages.splice(0, messages.length - 5000);
    writeJsonFile(MESSAGES_FILE, messages);
    return record;
  },


  getChannelInfo(tag, botToken) {
    const channels = this.getChannels();
    const cleanToken = botToken ? String(botToken).trim() : '';
    const tokenPrefix = cleanToken ? cleanToken.split(':')[0] : '';
    const found = channels.find(c => tag && c.tag && c.tag.toLowerCase() === tag.toLowerCase()) ||
                  channels.find(c =>
                    (cleanToken && c.botToken && c.botToken.trim() === cleanToken) ||
                    (tokenPrefix && c.botToken && c.botToken.startsWith(tokenPrefix))
                  );

    const finalTag = found ? found.tag : (tag || 'default');
    const cleanBotUser = (found && found.botUsername) ? found.botUsername.replace(/^@/, '').toLowerCase().trim() : '';
    const botPrefix = (found && found.botToken) ? found.botToken.split(':')[0] : (tokenPrefix || finalTag);

    return {
      tag: finalTag,
      name: found ? found.name : (tag ? `Account (${tag})` : 'Direct Chat'),
      botUsername: found ? (found.botUsername || '') : '',
      botToken: found ? found.botToken : cleanToken,
      botKey: cleanBotUser || botPrefix || finalTag
    };
  },

  async getConversations() {
    const admin = this.getAdminConfig();
    const adminId = admin.adminChatId ? String(admin.adminChatId) : null;
    // Only exclude negative Group/Forum IDs, do not exclude normal user chat IDs
    const EXCLUDE = new Set(['-1004309264544']);
    if (adminId && String(adminId).startsWith('-')) {
      EXCLUDE.add(String(adminId));
    }

    let leads = [], messages = [];
    try {
      if (await connectDB()) {
        leads = (await Lead.find({}).sort({ lastActiveAt: -1 })).map(l => l.toObject());
        messages = (await Message.find({}).sort({ createdAt: 1 })).map(m => m.toObject());
      } else {
        leads = readJsonFile(LEADS_FILE, []);
        messages = readJsonFile(MESSAGES_FILE, []);
      }
    } catch (e) {
      leads = readJsonFile(LEADS_FILE, []);
      messages = readJsonFile(MESSAGES_FILE, []);
    }

    const convMap = new Map();

    // 1. Process Leads (Only Bot Chat Leads — Channel Joins do not have 2-way chat)
    for (const lead of leads) {
      if (lead.joinType === 'channel_join') continue;
      const uid = String(lead.userId);
      if (EXCLUDE.has(uid)) continue;
      const displayName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || (lead.username ? `@${lead.username}` : `User ${lead.userId}`);
      const chTag = lead.channelTag || 'default';
      const chInfo = this.getChannelInfo(chTag, '');
      const convKey = `${uid}_${chTag}`;

      convMap.set(convKey, {
        convId: convKey,
        userId: lead.userId,
        userChatId: lead.userId,
        userName: displayName,
        userUsername: lead.username || '',
        channelTag: chTag,
        channelName: lead.channelName || chInfo.name,
        botUsername: chInfo.botUsername,
        botToken: chInfo.botToken,
        lastMessage: 'Started bot',
        lastMessageSender: 'system',
        lastMessageTime: lead.createdAt,
        unreadCount: 0
      });
    }

    // 2. Process Messages (Strictly mapped to specific account tag)
    for (const msg of messages) {
      const uid = String(msg.userId);
      if (EXCLUDE.has(uid)) continue;
      const chTag = msg.channelTag || 'default';
      const chInfo = this.getChannelInfo(chTag, msg.botToken);
      const convKey = `${uid}_${chTag}`;

      const existing = convMap.get(convKey) || {
        convId: convKey,
        userId: msg.userId,
        userChatId: msg.userChatId || msg.userId,
        userName: msg.userName || (msg.userUsername ? `@${msg.userUsername}` : `User ${msg.userId}`),
        userUsername: msg.userUsername || '',
        channelTag: chTag,
        channelName: chInfo.name,
        botUsername: chInfo.botUsername,
        botToken: msg.botToken || chInfo.botToken || '',
        lastMessage: '',
        lastMessageSender: '',
        lastMessageTime: msg.createdAt,
        unreadCount: 0
      };

      existing.lastMessage = msg.text || '[Media]';
      existing.lastMessageSender = msg.sender;
      existing.lastMessageTime = msg.createdAt;
      if (msg.sender === 'user') {
        if (msg.userName && msg.userName !== 'Admin') existing.userName = msg.userName;
        if (msg.userUsername) existing.userUsername = msg.userUsername;
      }
      if (msg.botToken) {
        existing.botToken = msg.botToken;
      }
      if (msg.userChatId) existing.userChatId = msg.userChatId;
      if (msg.channelTag && msg.channelTag !== 'default') {
        existing.channelTag = msg.channelTag;
        existing.channelName = chInfo.name;
      }
      if (msg.sender === 'user' && !msg.read) existing.unreadCount = (existing.unreadCount || 0) + 1;
      convMap.set(convKey, existing);
    }

    return Array.from(convMap.values())
      .filter(c => c.userName !== 'Admin' && c.userName !== 'Admin (Web Panel)')
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  },

  async markMessagesRead(convIdOrUserId) {
    const key = String(convIdOrUserId);
    let uid = key;
    let targetTag = null;

    if (key.includes('_')) {
      const idx = key.indexOf('_');
      uid = key.slice(0, idx);
      targetTag = key.slice(idx + 1);
    }

    try {
      if (await connectDB()) {
        const messages = await Message.find({
          userId: String(uid),
          sender: 'user',
          read: false
        });

        const toMarkIds = [];
        for (const m of messages) {
          if (!targetTag) {
            toMarkIds.push(m._id);
          } else {
            const chInfo = this.getChannelInfo(m.channelTag, m.botToken);
            const cleanBot = (chInfo.botUsername || '').replace(/^@/, '').toLowerCase().trim();
            const botKey = (chInfo.botKey || '').toLowerCase().trim();
            const chTag = (chInfo.tag || '').toLowerCase().trim();
            const msgTag = (m.channelTag || '').toLowerCase().trim();
            const target = targetTag.toLowerCase().trim();

            if (chTag === target || msgTag === target || cleanBot === target || botKey === target) {
              toMarkIds.push(m._id);
            }
          }
        }

        if (toMarkIds.length > 0) {
          await Message.updateMany({ _id: { $in: toMarkIds } }, { read: true });
        }
      }
    } catch (e) {}

    const jsonMsgs = readJsonFile(MESSAGES_FILE, []);
    let changed = false;
    for (const msg of jsonMsgs) {
      if (String(msg.userId) === String(uid) && msg.sender === 'user' && !msg.read) {
        if (!targetTag) {
          msg.read = true;
          changed = true;
        } else {
          const chInfo = this.getChannelInfo(msg.channelTag, msg.botToken);
          const cleanBot = (chInfo.botUsername || '').replace(/^@/, '').toLowerCase().trim();
          const botKey = (chInfo.botKey || '').toLowerCase().trim();
          const chTag = (chInfo.tag || '').toLowerCase().trim();
          const msgTag = (msg.channelTag || '').toLowerCase().trim();
          const target = targetTag.toLowerCase().trim();

          if (chTag === target || msgTag === target || cleanBot === target || botKey === target) {
            msg.read = true;
            changed = true;
          }
        }
      }
    }
    if (changed) writeJsonFile(MESSAGES_FILE, jsonMsgs);
    return true;
  },

  async getMessagesByUser(convIdOrUserId, limit = 200) {
    const key = String(convIdOrUserId);
    let uid = key;
    let targetTag = null;

    if (key.includes('_')) {
      const idx = key.indexOf('_');
      uid = key.slice(0, idx);
      targetTag = key.slice(idx + 1).toLowerCase().trim();
    }

    let allMessages = [];
    try {
      if (await connectDB()) {
        allMessages = (await Message.find({}).sort({ createdAt: 1 })).map(m => m.toObject());
      } else {
        allMessages = readJsonFile(MESSAGES_FILE, []);
      }
    } catch (e) {
      allMessages = readJsonFile(MESSAGES_FILE, []);
    }

    const userMsgs = allMessages.filter(m => String(m.userId) === String(uid) || String(m.userChatId) === String(uid));

    if (!targetTag) {
      return userMsgs.slice(-limit);
    }

    const filtered = userMsgs.filter(m => {
      const chInfo = this.getChannelInfo(m.channelTag, m.botToken);
      const cleanBot = (chInfo.botUsername || '').replace(/^@/, '').toLowerCase().trim();
      const botKey = (chInfo.botKey || '').toLowerCase().trim();
      const chTag = (chInfo.tag || '').toLowerCase().trim();
      const msgTag = (m.channelTag || '').toLowerCase().trim();

      return chTag === targetTag ||
             msgTag === targetTag ||
             cleanBot === targetTag ||
             botKey === targetTag;
    });

    if (filtered.length > 0) return filtered.slice(-limit);

    return userMsgs.slice(-limit);
  },

  getStats(options = {}) {
    const leads = readJsonFile(LEADS_FILE, []);
    const channels = this.getChannels();
    const admin = this.getAdminConfig();
    const messages = readJsonFile(MESSAGES_FILE, []);
    const clicks = readJsonFile(CLICKS_FILE, []);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const range = options.range || 'all';
    const timeWindow = resolveTimeWindow(range, options.startDate, options.endDate);

    let todayLeads = 0, successfulCapi = 0, failedCapi = 0, channelJoins = 0, activeMembers = 0, leftMembers = 0;
    const channelCounts = {};
    const channelTodayCounts = {};
    const channelCapiSuccess = {};
    const hourlyJoins = new Array(24).fill(0);
    const deviceStats = { iOS: 0, Android: 0, Desktop: 0 };
    
    // Global & Isolated Platform Breakdown
    const platformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
    const channelPlatformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
    const botPlatformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };

    // Global & Isolated Placement Breakdown
    const placementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
    const channelPlacementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
    const botPlacementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };

    // Global & Isolated Geo Intelligence
    const stateCounts = {};
    const cityCounts = {};
    const channelStateCounts = {};
    const channelCityCounts = {};
    const botStateCounts = {};
    const botCityCounts = {};

    const filteredLeads = leads.filter(l => {
      const t = new Date(l.createdAt || 0).getTime();
      return t >= timeWindow.start && t <= timeWindow.end;
    });

    for (const lead of filteredLeads) {
      const date = new Date(lead.createdAt);
      const time = date.getTime();
      const isToday = time >= startOfToday;
      if (isToday) {
        todayLeads++;
      }
      const hr = date.getHours();
      hourlyJoins[hr] = (hourlyJoins[hr] || 0) + 1;

      const isChanJoin = lead.joinType === 'channel_join';

      if (lead.capiStatus === 'success') successfulCapi++;
      if (lead.capiStatus === 'failed') failedCapi++;
      if (isChanJoin) {
        channelJoins++;
        if (lead.retentionStatus === 'left') leftMembers++;
        else activeMembers++;
      }
      const ch = lead.channelTag || 'other';
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      if (isToday) channelTodayCounts[ch] = (channelTodayCounts[ch] || 0) + 1;
      if (lead.capiStatus === 'success') channelCapiSuccess[ch] = (channelCapiSuccess[ch] || 0) + 1;

      // Platform attribution (ONLY when genuinely present from ad parameter)
      if (lead.platform) {
        const p = lead.platform.toLowerCase();
        const isIg = p.includes('insta') || p === 'ig';
        if (isIg) {
          platformStats.instagram.joins++;
          if (isChanJoin) channelPlatformStats.instagram.joins++;
          else botPlatformStats.instagram.joins++;
        } else if (p.includes('face') || p === 'fb') {
          platformStats.facebook.joins++;
          if (isChanJoin) channelPlatformStats.facebook.joins++;
          else botPlatformStats.facebook.joins++;
        }
      }

      // Placement attribution (ONLY when genuinely present from ad placement)
      if (lead.placement) {
        const pl = lead.placement.toLowerCase();
        let plKey = null;
        if (pl.includes('reel')) plKey = 'reels';
        else if (pl.includes('stor')) plKey = 'stories';
        else if (pl.includes('feed')) plKey = 'feed';

        if (plKey) {
          placementStats[plKey].joins++;
          if (isChanJoin) channelPlacementStats[plKey].joins++;
          else botPlacementStats[plKey].joins++;
        }
      }

      // Geo attribution (Only real IP-detected geo)
      if (lead.state) {
        stateCounts[lead.state] = (stateCounts[lead.state] || 0) + 1;
        if (isChanJoin) channelStateCounts[lead.state] = (channelStateCounts[lead.state] || 0) + 1;
        else botStateCounts[lead.state] = (botStateCounts[lead.state] || 0) + 1;
      }

      if (lead.city) {
        cityCounts[lead.city] = (cityCounts[lead.city] || 0) + 1;
        if (isChanJoin) channelCityCounts[lead.city] = (channelCityCounts[lead.city] || 0) + 1;
        else botCityCounts[lead.city] = (botCityCounts[lead.city] || 0) + 1;
      }
    }

    const channelTagsSet = new Set(channels.filter(c => c.destinationType === 'channel').map(c => c.tag.toLowerCase()));
    let channelClicks = 0;
    let botClicks = 0;
    const channelDeviceStats = { iOS: 0, Android: 0, Desktop: 0 };
    const botDeviceStats = { iOS: 0, Android: 0, Desktop: 0 };

    const filteredClicks = clicks.filter(c => {
      const t = new Date(c.createdAt || 0).getTime();
      return t >= timeWindow.start && t <= timeWindow.end;
    });

    for (const clk of filteredClicks) {
      const dev = clk.device || 'Android';
      const tag = (clk.channelTag || '').toLowerCase();
      const isChan = channelTagsSet.has(tag);

      if (dev === 'iOS') deviceStats.iOS++;
      else if (dev === 'Desktop') deviceStats.Desktop++;
      else deviceStats.Android++;

      if (isChan) {
        channelClicks++;
        if (dev === 'iOS') channelDeviceStats.iOS++;
        else if (dev === 'Desktop') channelDeviceStats.Desktop++;
        else channelDeviceStats.Android++;
      } else {
        botClicks++;
        if (dev === 'iOS') botDeviceStats.iOS++;
        else if (dev === 'Desktop') botDeviceStats.Desktop++;
        else botDeviceStats.Android++;
      }

      // Platform & Placement Clicks (ONLY when genuinely present)
      if (clk.platform) {
        const p = clk.platform.toLowerCase();
        const isIg = p.includes('insta') || p === 'ig';
        if (isIg) {
          platformStats.instagram.clicks++;
          if (isChan) channelPlatformStats.instagram.clicks++;
          else botPlatformStats.instagram.clicks++;
        } else if (p.includes('face') || p === 'fb') {
          platformStats.facebook.clicks++;
          if (isChan) channelPlatformStats.facebook.clicks++;
          else botPlatformStats.facebook.clicks++;
        }
      }

      if (clk.placement) {
        const pl = clk.placement.toLowerCase();
        let plKey = null;
        if (pl.includes('reel')) plKey = 'reels';
        else if (pl.includes('stor')) plKey = 'stories';
        else if (pl.includes('feed')) plKey = 'feed';

        if (plKey) {
          placementStats[plKey].clicks++;
          if (isChan) channelPlacementStats[plKey].clicks++;
          else botPlacementStats[plKey].clicks++;
        }
      }

      if (clk.state) {
        stateCounts[clk.state] = (stateCounts[clk.state] || 0) + 1;
        if (isChan) channelStateCounts[clk.state] = (channelStateCounts[clk.state] || 0) + 1;
        else botStateCounts[clk.state] = (botStateCounts[clk.state] || 0) + 1;
      }
      if (clk.city) {
        cityCounts[clk.city] = (cityCounts[clk.city] || 0) + 1;
        if (isChan) channelCityCounts[clk.city] = (channelCityCounts[clk.city] || 0) + 1;
        else botCityCounts[clk.city] = (botCityCounts[clk.city] || 0) + 1;
      }
    }

    const uniqueConvKeys = new Set();
    for (const l of filteredLeads) {
      uniqueConvKeys.add(`${l.userId}_${l.channelTag || 'default'}`);
    }
    for (const m of messages) {
      uniqueConvKeys.add(`${m.userId}_${m.channelTag || 'default'}`);
    }

    const totalClicks = filteredClicks.length;
    const conversionRate = channelClicks > 0 ? Math.round((channelJoins / channelClicks) * 100) : 0;
    const botLeads = filteredLeads.filter(l => l.joinType !== 'channel_join').length;
    const botConversionRate = botClicks > 0 ? Math.round((botLeads / botClicks) * 100) : 0;

    platformStats.facebook.conversionRate = platformStats.facebook.clicks > 0
      ? Math.round((platformStats.facebook.joins / platformStats.facebook.clicks) * 100) : 0;
    platformStats.instagram.conversionRate = platformStats.instagram.clicks > 0
      ? Math.round((platformStats.instagram.joins / platformStats.instagram.clicks) * 100) : 0;

    channelPlatformStats.facebook.conversionRate = channelPlatformStats.facebook.clicks > 0
      ? Math.round((channelPlatformStats.facebook.joins / channelPlatformStats.facebook.clicks) * 100) : 0;
    channelPlatformStats.instagram.conversionRate = channelPlatformStats.instagram.clicks > 0
      ? Math.round((channelPlatformStats.instagram.joins / channelPlatformStats.instagram.clicks) * 100) : 0;

    botPlatformStats.facebook.conversionRate = botPlatformStats.facebook.clicks > 0
      ? Math.round((botPlatformStats.facebook.joins / botPlatformStats.facebook.clicks) * 100) : 0;
    botPlatformStats.instagram.conversionRate = botPlatformStats.instagram.clicks > 0
      ? Math.round((botPlatformStats.instagram.joins / botPlatformStats.instagram.clicks) * 100) : 0;

    const mapTop = (obj) => Object.entries(obj).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    const mapCities = (obj) => Object.entries(obj).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    const geoStats = { topStates: mapTop(stateCounts), topCities: mapCities(cityCounts) };
    const channelGeoStats = { topStates: mapTop(channelStateCounts), topCities: mapCities(channelCityCounts) };
    const botGeoStats = { topStates: mapTop(botStateCounts), topCities: mapCities(botCityCounts) };

    const channelBreakdown = channels.map(c => ({
      tag: c.tag,
      name: c.name || c.tag,
      destinationType: c.destinationType || 'bot',
      totalJoins: channelCounts[c.tag] || 0,
      todayJoins: channelTodayCounts[c.tag] || 0,
      capiSuccess: channelCapiSuccess[c.tag] || 0
    }));

    return {
      selectedRange: range,
      timeWindowLabel: timeWindow.label,
      totalLeads: filteredLeads.length,
      allTimeTotalLeads: leads.length,
      botLeads,
      channelJoins,
      todayLeads,
      successfulCapi,
      failedCapi,
      totalChannels: channels.length,
      channelCounts,
      channelTodayCounts,
      channelBreakdown,
      totalClicks,
      conversionRate,
      channelClicks,
      channelDeviceStats,
      botClicks,
      botDeviceStats,
      botConversionRate,
      hourlyJoins,
      deviceStats,
      platformStats,
      placementStats,
      geoStats,
      channelPlatformStats,
      channelPlacementStats,
      channelGeoStats,
      botPlatformStats,
      botPlacementStats,
      botGeoStats,
      fraudBlockedCount: readJsonFile(FRAUD_FILE, []).length,
      fraudShieldStatus: 'Active',
      retention: { activeMembers, leftMembers },
      adminConnected: !!admin.adminChatId,
      activeChats: uniqueConvKeys.size
    };
  },

  async getStatsAsync(options = {}) {
    try {
      if (await connectDB()) {
        const channels = this.getChannels();
        const admin = this.getAdminConfig();
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const range = options.range || 'all';
        const timeWindow = resolveTimeWindow(range, options.startDate, options.endDate);

        const dateQuery = (timeWindow.start > 0 || timeWindow.end < Infinity)
          ? { createdAt: { $gte: new Date(timeWindow.start), $lte: new Date(timeWindow.end) } }
          : {};

        const leads = await Lead.find(dateQuery).lean();
        const allLeadsCount = await Lead.countDocuments({});
        const clicks = await ClickLog.find(dateQuery).limit(5000).lean();

        let todayLeads = 0, successfulCapi = 0, failedCapi = 0, channelJoins = 0, activeMembers = 0, leftMembers = 0;
        const channelCounts = {};
        const channelTodayCounts = {};
        const channelCapiSuccess = {};
        const hourlyJoins = new Array(24).fill(0);
        const channelTagsSet = new Set(channels.filter(c => c.destinationType === 'channel').map(c => c.tag.toLowerCase()));
        let channelClicks = 0;
        let botClicks = 0;
        const channelDeviceStats = { iOS: 0, Android: 0, Desktop: 0 };
        const botDeviceStats = { iOS: 0, Android: 0, Desktop: 0 };
        const deviceStats = { iOS: 0, Android: 0, Desktop: 0 };

        const platformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
        const channelPlatformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };
        const botPlatformStats = { facebook: { clicks: 0, joins: 0, conversionRate: 0 }, instagram: { clicks: 0, joins: 0, conversionRate: 0 } };

        const placementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
        const channelPlacementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };
        const botPlacementStats = { reels: { clicks: 0, joins: 0 }, stories: { clicks: 0, joins: 0 }, feed: { clicks: 0, joins: 0 } };

        const stateCounts = {};
        const cityCounts = {};
        const channelStateCounts = {};
        const channelCityCounts = {};
        const botStateCounts = {};
        const botCityCounts = {};

        for (const lead of leads) {
          const date = new Date(lead.createdAt);
          const time = date.getTime();
          const isToday = time >= startOfToday;
          if (isToday) {
            todayLeads++;
          }
          const hr = date.getHours();
          hourlyJoins[hr] = (hourlyJoins[hr] || 0) + 1;

          const isChanJoin = lead.joinType === 'channel_join';

          if (lead.capiStatus === 'success') successfulCapi++;
          if (lead.capiStatus === 'failed') failedCapi++;
          if (isChanJoin) {
            channelJoins++;
            if (lead.retentionStatus === 'left') leftMembers++;
            else activeMembers++;
          }
          const ch = lead.channelTag || 'other';
          channelCounts[ch] = (channelCounts[ch] || 0) + 1;
          if (isToday) channelTodayCounts[ch] = (channelTodayCounts[ch] || 0) + 1;
          if (lead.capiStatus === 'success') channelCapiSuccess[ch] = (channelCapiSuccess[ch] || 0) + 1;

          // Platform & Placement Joins (ONLY when genuinely present)
          if (lead.platform) {
            const p = lead.platform.toLowerCase();
            const isIg = p.includes('insta') || p === 'ig';
            if (isIg) {
              platformStats.instagram.joins++;
              if (isChanJoin) channelPlatformStats.instagram.joins++;
              else botPlatformStats.instagram.joins++;
            } else if (p.includes('face') || p === 'fb') {
              platformStats.facebook.joins++;
              if (isChanJoin) channelPlatformStats.facebook.joins++;
              else botPlatformStats.facebook.joins++;
            }
          }

          if (lead.placement) {
            const pl = lead.placement.toLowerCase();
            let plKey = null;
            if (pl.includes('reel')) plKey = 'reels';
            else if (pl.includes('stor')) plKey = 'stories';
            else if (pl.includes('feed')) plKey = 'feed';

            if (plKey) {
              placementStats[plKey].joins++;
              if (isChanJoin) channelPlacementStats[plKey].joins++;
              else botPlacementStats[plKey].joins++;
            }
          }

          // Geo attribution (Only real IP-detected geo)
          if (lead.state) {
            stateCounts[lead.state] = (stateCounts[lead.state] || 0) + 1;
            if (isChanJoin) channelStateCounts[lead.state] = (channelStateCounts[lead.state] || 0) + 1;
            else botStateCounts[lead.state] = (botStateCounts[lead.state] || 0) + 1;
          }

          if (lead.city) {
            cityCounts[lead.city] = (cityCounts[lead.city] || 0) + 1;
            if (isChanJoin) channelCityCounts[lead.city] = (channelCityCounts[lead.city] || 0) + 1;
            else botCityCounts[lead.city] = (botCityCounts[lead.city] || 0) + 1;
          }
        }

        for (const clk of clicks) {
          const dev = clk.device || 'Android';
          const tag = (clk.channelTag || '').toLowerCase();
          const isChan = channelTagsSet.has(tag);

          if (dev === 'iOS') deviceStats.iOS++;
          else if (dev === 'Desktop') deviceStats.Desktop++;
          else deviceStats.Android++;

          if (isChan) {
            channelClicks++;
            if (dev === 'iOS') channelDeviceStats.iOS++;
            else if (dev === 'Desktop') channelDeviceStats.Desktop++;
            else channelDeviceStats.Android++;
          } else {
            botClicks++;
            if (dev === 'iOS') botDeviceStats.iOS++;
            else if (dev === 'Desktop') botDeviceStats.Desktop++;
            else botDeviceStats.Android++;
          }

          // Platform & Placement Clicks (ONLY when genuinely present)
          if (clk.platform) {
            const p = clk.platform.toLowerCase();
            const isIg = p.includes('insta') || p === 'ig';
            if (isIg) {
              platformStats.instagram.clicks++;
              if (isChan) channelPlatformStats.instagram.clicks++;
              else botPlatformStats.instagram.clicks++;
            } else if (p.includes('face') || p === 'fb') {
              platformStats.facebook.clicks++;
              if (isChan) channelPlatformStats.facebook.clicks++;
              else botPlatformStats.facebook.clicks++;
            }
          }

          if (clk.placement) {
            const pl = clk.placement.toLowerCase();
            let plKey = null;
            if (pl.includes('reel')) plKey = 'reels';
            else if (pl.includes('stor')) plKey = 'stories';
            else if (pl.includes('feed')) plKey = 'feed';

            if (plKey) {
              placementStats[plKey].clicks++;
              if (isChan) channelPlacementStats[plKey].clicks++;
              else botPlacementStats[plKey].clicks++;
            }
          }

          if (clk.state) {
            stateCounts[clk.state] = (stateCounts[clk.state] || 0) + 1;
            if (isChan) channelStateCounts[clk.state] = (channelStateCounts[clk.state] || 0) + 1;
            else botStateCounts[clk.state] = (botStateCounts[clk.state] || 0) + 1;
          }
          if (clk.city) {
            cityCounts[clk.city] = (cityCounts[clk.city] || 0) + 1;
            if (isChan) channelCityCounts[clk.city] = (channelCityCounts[clk.city] || 0) + 1;
            else botCityCounts[clk.city] = (botCityCounts[clk.city] || 0) + 1;
          }
        }

        const convs = await this.getConversations();
        const activeChats = convs.length;

        const totalClicks = clicks.length;
        const conversionRate = channelClicks > 0 ? Math.round((channelJoins / channelClicks) * 100) : 0;
        const botLeads = leads.filter(l => l.joinType !== 'channel_join').length;
        const botConversionRate = botClicks > 0 ? Math.round((botLeads / botClicks) * 100) : 0;

        platformStats.facebook.conversionRate = platformStats.facebook.clicks > 0
          ? Math.round((platformStats.facebook.joins / platformStats.facebook.clicks) * 100) : 0;
        platformStats.instagram.conversionRate = platformStats.instagram.clicks > 0
          ? Math.round((platformStats.instagram.joins / platformStats.instagram.clicks) * 100) : 0;

        channelPlatformStats.facebook.conversionRate = channelPlatformStats.facebook.clicks > 0
          ? Math.round((channelPlatformStats.facebook.joins / channelPlatformStats.facebook.clicks) * 100) : 0;
        channelPlatformStats.instagram.conversionRate = channelPlatformStats.instagram.clicks > 0
          ? Math.round((channelPlatformStats.instagram.joins / channelPlatformStats.instagram.clicks) * 100) : 0;

        botPlatformStats.facebook.conversionRate = botPlatformStats.facebook.clicks > 0
          ? Math.round((botPlatformStats.facebook.joins / botPlatformStats.facebook.clicks) * 100) : 0;
        botPlatformStats.instagram.conversionRate = botPlatformStats.instagram.clicks > 0
          ? Math.round((botPlatformStats.instagram.joins / botPlatformStats.instagram.clicks) * 100) : 0;

        const mapTop = (obj) => Object.entries(obj).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 8);
        const mapCities = (obj) => Object.entries(obj).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count).slice(0, 8);

        const geoStats = { topStates: mapTop(stateCounts), topCities: mapCities(cityCounts) };
        const channelGeoStats = { topStates: mapTop(channelStateCounts), topCities: mapCities(channelCityCounts) };
        const botGeoStats = { topStates: mapTop(botStateCounts), topCities: mapCities(botCityCounts) };

        const channelBreakdown = channels.map(c => ({
          tag: c.tag,
          name: c.name || c.tag,
          destinationType: c.destinationType || 'bot',
          totalJoins: channelCounts[c.tag] || 0,
          todayJoins: channelTodayCounts[c.tag] || 0,
          capiSuccess: channelCapiSuccess[c.tag] || 0
        }));

        const fraudBlockedCount = await FraudLog.countDocuments(dateQuery);

        return {
          selectedRange: range,
          timeWindowLabel: timeWindow.label,
          totalLeads: leads.length,
          allTimeTotalLeads: allLeadsCount,
          botLeads,
          channelJoins,
          todayLeads,
          successfulCapi,
          failedCapi,
          totalChannels: channels.length,
          channelCounts,
          channelTodayCounts,
          channelBreakdown,
          totalClicks,
          conversionRate,
          channelClicks,
          channelDeviceStats,
          botClicks,
          botDeviceStats,
          botConversionRate,
          hourlyJoins,
          deviceStats,
          platformStats,
          placementStats,
          geoStats,
          channelPlatformStats,
          channelPlacementStats,
          channelGeoStats,
          botPlatformStats,
          botPlacementStats,
          botGeoStats,
          fraudBlockedCount,
          fraudShieldStatus: 'Active',
          retention: { activeMembers, leftMembers },
          adminConnected: !!admin.adminChatId,
          activeChats
        };
      }
    } catch (e) {
      console.warn('⚠️ getStatsAsync fallback to JSON:', e.message);
    }
    return this.getStats(options);
  },

  async markLeadLeft(userId, chatId) {
    const uid = String(userId);
    try {
      if (await connectDB()) {
        await Lead.updateMany({ userId: uid }, { $set: { retentionStatus: 'left', leftAt: new Date() } });
      }
    } catch (e) {}

    const leads = readJsonFile(LEADS_FILE, []);
    let modified = false;
    for (const l of leads) {
      if (String(l.userId) === uid) {
        l.retentionStatus = 'left';
        l.leftAt = new Date().toISOString();
        modified = true;
      }
    }
    if (modified) writeJsonFile(LEADS_FILE, leads);
  },

  resolveGeo(ip) {
    return resolveGeo(ip);
  },

  async logClick(clickData) {
    try {
      if (await connectDB()) {
        const click = new ClickLog({
          channelTag: clickData.channelTag || 'default',
          adName: clickData.adName || '',
          adId: clickData.adId || '',
          campaignName: clickData.campaignName || '',
          fbclid: clickData.fbclid || '',
          device: clickData.device || 'mobile',
          platform: clickData.platform || 'Facebook',
          placement: clickData.placement || 'Feed',
          city: clickData.city || '',
          state: clickData.state || 'Maharashtra',
          country: clickData.country || 'India',
          ip: clickData.ip || ''
        });
        await click.save();
        return;
      }
    } catch (e) {}

    const clicks = readJsonFile(CLICKS_FILE, []);
    clicks.push({
      id: 'clk_' + Date.now(),
      channelTag: clickData.channelTag || 'default',
      adName: clickData.adName || '',
      adId: clickData.adId || '',
      campaignName: clickData.campaignName || '',
      fbclid: clickData.fbclid || '',
      device: clickData.device || 'mobile',
      platform: clickData.platform || 'Facebook',
      placement: clickData.placement || 'Feed',
      city: clickData.city || '',
      state: clickData.state || 'Maharashtra',
      country: clickData.country || 'India',
      ip: clickData.ip || '',
      createdAt: new Date().toISOString()
    });
    // Keep last 10,000 clicks in local JSON
    if (clicks.length > 10000) clicks.splice(0, clicks.length - 10000);
    writeJsonFile(CLICKS_FILE, clicks);
  },

  async logFraudClick(fraudData) {
    try {
      if (await connectDB()) {
        const fraud = new FraudLog({
          channelTag: fraudData.channelTag || 'default',
          ip: fraudData.ip || '',
          userAgent: fraudData.userAgent || '',
          reason: fraudData.reason || 'Bot detected',
          score: fraudData.score || 90
        });
        await fraud.save();
        return;
      }
    } catch (e) {}

    const list = readJsonFile(FRAUD_FILE, []);
    list.push({
      id: 'frd_' + Date.now(),
      channelTag: fraudData.channelTag || 'default',
      ip: fraudData.ip || '',
      userAgent: fraudData.userAgent || '',
      reason: fraudData.reason || 'Bot detected',
      score: fraudData.score || 90,
      createdAt: new Date().toISOString()
    });
    if (list.length > 2000) list.splice(0, list.length - 2000);
    writeJsonFile(FRAUD_FILE, list);
  },

  // 90-Day Retention Auto-Purge (Only purges Channel Join data; Bot chat data stays 100% permanent)
  async purgeOldChannelData() {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    try {
      if (await connectDB()) {
        const deletedLeads = await Lead.deleteMany({
          joinType: 'channel_join',
          createdAt: { $lt: cutoffDate }
        });
        const deletedClicks = await ClickLog.deleteMany({
          createdAt: { $lt: cutoffDate }
        });
        if (deletedLeads.deletedCount || deletedClicks.deletedCount) {
          console.log(`🧹 [90-Day Retention Purge] Removed ${deletedLeads.deletedCount || 0} old channel joins and ${deletedClicks.deletedCount || 0} old click logs.`);
        }
      }
    } catch (e) {
      console.warn('⚠️ Purge error in Mongo fallback to JSON:', e.message);
    }

    // Local JSON purge for channel joins only
    const leads = readJsonFile(LEADS_FILE, []);
    const validLeads = leads.filter(l => {
      if (l.joinType !== 'channel_join') return true; // Keep ALL bot chat leads permanent!
      return new Date(l.createdAt).getTime() >= cutoffDate.getTime();
    });
    if (validLeads.length !== leads.length) {
      writeJsonFile(LEADS_FILE, validLeads);
    }

    const clicks = readJsonFile(CLICKS_FILE, []);
    const validClicks = clicks.filter(c => new Date(c.createdAt).getTime() >= cutoffDate.getTime());
    if (validClicks.length !== clicks.length) {
      writeJsonFile(CLICKS_FILE, validClicks);
    }
  }
};

// Run 90-day retention cleanup on startup & once daily
setTimeout(() => db.purgeOldChannelData().catch(() => {}), 5000);
setInterval(() => db.purgeOldChannelData().catch(() => {}), 24 * 60 * 60 * 1000);

module.exports = db;
