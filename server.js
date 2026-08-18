require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { initBot, registerChannelBot, sendMessageToUser, setEventBroadcaster } = require('./bot');
const { sendMetaCapiLead } = require('./metaCapi');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception caught safely:', err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection caught safely:', reason);
});

// Health Check for Render
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Page Routes (Multi-Page System)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/leads', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'leads.html'));
});

app.get('/channels', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'channels.html'));
});

app.get('/links', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'links.html'));
});

// Client Dedicated Chat Pages (No Admin Navbar)
app.get('/client/:channelTag', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Real-Time SSE Event Stream for 0ms Instant Chat Sync
const sseClients = new Set();

function broadcastChatEvent(eventData) {
  const message = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
      if (typeof client.flush === 'function') client.flush();
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Hook into Bot event stream
setEventBroadcaster(broadcastChatEvent);

// Dedicated SSE Stream Endpoint
app.get('/api/chat/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  sseClients.add(res);

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ----------------- API ROUTES -----------------

// 0. Get App Config (bot username, personal username)
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || 'southboookbot',
    personalUsername: process.env.PERSONAL_TELEGRAM_USERNAME || 'sparkspires'
  });
});

// 0b. Authentication (Admin Password & Client PIN)
app.post('/api/auth/login', async (req, res) => {
  const { password, role, channelTag } = req.body;
  if (!password || String(password).trim() === '') {
    return res.status(400).json({ success: false, error: 'Password / PIN is required' });
  }
  const cleanPass = String(password).trim();
  const adminPass = String(process.env.ADMIN_PASSWORD || 'admin1234').trim();

  // Admin Login Check
  if (role === 'admin' || (!channelTag && !role)) {
    if (cleanPass === adminPass) {
      return res.json({ success: true, role: 'admin', token: 'auth_adm_' + Buffer.from(adminPass).toString('base64') });
    } else {
      return res.status(401).json({ success: false, error: 'Incorrect Admin Password' });
    }
  }

  // Client Channel Login Check
  const channels = await db.getChannelsAsync();
  const searchTag = (channelTag || '').toLowerCase().trim();
  const channel = channels.find(c => 
    (c.tag && c.tag.toLowerCase() === searchTag) ||
    (c.botUsername && c.botUsername.toLowerCase().replace(/^@/, '') === searchTag)
  ) || channels.find(c => c.name && c.name.toLowerCase().includes(searchTag));

  // Master admin password unlocks any client portal too
  if (cleanPass === adminPass) {
    return res.json({ success: true, role: 'admin', channelTag: channel ? channel.tag : searchTag, token: 'auth_adm_' + Buffer.from(cleanPass).toString('base64') });
  }

  const targetPin = (channel && channel.accessPin) ? String(channel.accessPin).trim() : '1234';
  if (cleanPass === targetPin) {
    return res.json({ success: true, role: 'client', channelTag: channel ? channel.tag : searchTag, token: 'auth_cli_' + Buffer.from(cleanPass).toString('base64') });
  } else {
    return res.status(401).json({ success: false, error: 'Incorrect Access PIN for this channel' });
  }
});

// 1. Get Dashboard Stats
app.get('/api/stats', async (req, res) => {
  const stats = await db.getStatsAsync();
  res.json({ success: true, data: stats });
});

// 2. Get Leads (with optional search/filter)
app.get('/api/leads', async (req, res) => {
  const limit = parseInt(req.query.limit) || 150;
  const channel = req.query.channel;
  const search = (req.query.search || '').toLowerCase();

  let leads = await db.getLeadsAsync(500);

  if (channel && channel !== 'all') {
    leads = leads.filter(l => l.channelTag === channel);
  }

  if (search) {
    leads = leads.filter(l =>
      (l.firstName && l.firstName.toLowerCase().includes(search)) ||
      (l.lastName && l.lastName.toLowerCase().includes(search)) ||
      (l.username && l.username.toLowerCase().includes(search)) ||
      (l.userId && String(l.userId).includes(search)) ||
      (l.rawParam && l.rawParam.toLowerCase().includes(search))
    );
  }

  res.json({
    success: true,
    count: leads.length,
    data: leads.slice(0, limit)
  });
});

// 3. Get Channels
app.get('/api/channels', async (req, res) => {
  const channels = await db.getChannelsAsync();
  res.json({ success: true, data: channels });
});

// 4. Create / Update Channel
app.post('/api/channels', async (req, res) => {
  const { tag, name, link, buttonText, welcomeMessage, pixelId, accessToken, botToken } = req.body;

  if (!tag || tag.trim() === '') {
    return res.status(400).json({ success: false, error: 'Channel Tag is required (e.g. cric1)' });
  }

  if (!link || link.trim() === '') {
    return res.status(400).json({ success: false, error: 'Telegram Username or Link is required' });
  }

  let cleanLink = link.trim();
  if (!cleanLink.startsWith('http://') && !cleanLink.startsWith('https://')) {
    cleanLink = `https://t.me/${cleanLink.replace(/^@/, '')}`;
  }

  const saved = await db.saveChannel({
    tag,
    name: name || `Account ${tag}`,
    botUsername: req.body.botUsername ? req.body.botUsername.replace(/^@/, '').trim() : '',
    link: cleanLink,
    buttonText,
    welcomeMessage,
    pixelId,
    accessToken,
    botToken: botToken ? botToken.trim() : '',
    accessPin: req.body.accessPin ? String(req.body.accessPin).trim() : '1234'
  });

  // Dynamically start new bot instance if a custom bot token was added
  if (saved.botToken) {
    registerChannelBot(saved);
  }

  res.json({ success: true, data: saved });
});

// 5. Delete Channel
app.delete('/api/channels/:tag', async (req, res) => {
  const { tag } = req.params;
  await db.deleteChannel(tag);
  res.json({ success: true, message: `Channel ${tag} deleted` });
});

// 6. Test Meta CAPI Lead simulation
app.post('/api/test-lead', async (req, res) => {
  const { channelTag, customParam } = req.body;
  const channel = db.getChannelByTag(channelTag);

  const fakeUserId = Math.floor(100000000 + Math.random() * 900000000);
  const param = customParam || (channel ? channel.tag : 'test_param');

  const capiResult = await sendMetaCapiLead({
    userId: fakeUserId,
    param: param,
    firstName: 'Test',
    lastName: 'User',
    username: 'test_lead_preview',
    customPixelId: channel?.pixelId,
    customAccessToken: channel?.accessToken,
    channelName: channel ? channel.name : 'Test Lead Simulation'
  });

  const lead = await db.addLead({
    userId: fakeUserId,
    firstName: 'Test',
    lastName: 'Lead',
    username: 'test_lead_preview',
    channelTag: channel ? channel.tag : 'test',
    channelName: channel ? channel.name : 'Test Channel',
    rawParam: param,
    capiStatus: capiResult.skipped ? 'skipped' : (capiResult.success ? 'success' : 'failed'),
    capiTraceId: capiResult.traceId || 'trace_test_' + Date.now(),
    capiError: capiResult.error || (capiResult.skipped ? 'Missing Meta credentials' : null)
  });

  res.json({
    success: true,
    capi: capiResult,
    lead: lead
  });
});

// 7. Export Leads as CSV
app.get('/api/export', async (req, res) => {
  const leads = await db.getLeadsAsync(5000);
  let csv = 'ID,Date Time,Telegram User ID,Name,Username,Channel Tag,Channel Name,Start Param,Meta CAPI Status,Trace ID\n';

  for (const l of leads) {
    const fullName = `"${(l.firstName + ' ' + l.lastName).trim().replace(/"/g, '""')}"`;
    const username = l.username ? `@${l.username}` : 'N/A';
    const channelName = `"${(l.channelName || '').replace(/"/g, '""')}"`;
    const param = `"${(l.rawParam || '').replace(/"/g, '""')}"`;
    const id = l._id || l.id || '';
    csv += `${id},"${l.createdAt}",${l.userId},${fullName},${username},${l.channelTag},${channelName},${param},${l.capiStatus},"${l.capiTraceId}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.csv`);
  res.send(csv);
});

// ----------------- LIVE CHAT INBOX API -----------------

// 8. Get Conversations (with optional channel filter for dedicated client links)
app.get('/api/chat/conversations', async (req, res) => {
  const channel = req.query.channel;
  let convs = await db.getConversations();

  if (channel && channel !== 'all') {
    const searchTag = channel.toLowerCase().trim();
    const allChans = await db.getChannelsAsync();
    const matchedChans = allChans.filter(c => 
      (c.tag && c.tag.toLowerCase() === searchTag) ||
      (c.botUsername && c.botUsername.toLowerCase() === searchTag) ||
      (c.name && c.name.toLowerCase().includes(searchTag))
    );
    const validTags = new Set([searchTag, ...matchedChans.map(c => (c.tag || '').toLowerCase())]);
    const validBots = new Set(matchedChans.map(c => (c.botUsername || '').toLowerCase().replace(/^@/, '')).filter(Boolean));

    convs = convs.filter(c => {
      const cTag = (c.channelTag || '').toLowerCase();
      const cBot = (c.botUsername || '').toLowerCase().replace(/^@/, '');
      return validTags.has(cTag) || (cBot && validBots.has(cBot));
    });
  }

  res.json({ success: true, data: convs });
});

// 8b. Get Public Safe Client Channel Info (No secrets/tokens exposed)
app.get('/api/client/info/:channelTag', async (req, res) => {
  const { channelTag } = req.params;
  const searchTag = (channelTag || '').toLowerCase().trim();
  const channels = await db.getChannelsAsync();
  const channel = channels.find(c => 
    (c.tag && c.tag.toLowerCase() === searchTag) ||
    (c.botUsername && c.botUsername.toLowerCase().replace(/^@/, '') === searchTag)
  ) || channels.find(c => c.name && c.name.toLowerCase().includes(searchTag));

  if (channel) {
    res.json({
      success: true,
      data: {
        tag: channel.tag,
        name: channel.name,
        botUsername: channel.botUsername,
        buttonText: channel.buttonText,
        welcomeMessage: channel.welcomeMessage
      }
    });
  } else {
    res.json({
      success: true,
      data: {
        tag: channelTag,
        name: `Account (${channelTag})`,
        botUsername: '',
        welcomeMessage: ''
      }
    });
  }
});

// 9. Get Messages for a specific User
app.get('/api/chat/messages/:userId', async (req, res) => {
  const { userId } = req.params;
  const messages = await db.getMessagesByUser(userId, 200);
  console.log(`📥 [API Messages] Req for "${userId}" -> Found ${messages.length} messages`);
  await db.markMessagesRead(userId);
  res.json({ success: true, data: messages });
});

// 9b. Upload Media File (Images & Voice Recordings)
app.post('/api/chat/upload', (req, res) => {
  try {
    const { dataUrl, filename, mediaType } = req.body;
    if (!dataUrl) {
      return res.status(400).json({ success: false, error: 'No dataUrl provided' });
    }

    let ext = 'bin';
    let buffer;

    if (dataUrl.includes(';base64,')) {
      const parts = dataUrl.split(';base64,');
      const header = parts[0].toLowerCase();
      const base64Data = parts[1];
      buffer = Buffer.from(base64Data, 'base64');

      if (header.includes('image/png')) ext = 'png';
      else if (header.includes('image/jpeg') || header.includes('image/jpg')) ext = 'jpg';
      else if (header.includes('image/webp')) ext = 'webp';
      else if (header.includes('image/gif')) ext = 'gif';
      else if (header.includes('audio/ogg') || header.includes('audio/opus')) ext = 'ogg';
      else if (header.includes('audio/webm')) ext = 'webm';
      else if (header.includes('audio/mp4') || header.includes('audio/m4a')) ext = 'mp4';
      else if (header.includes('audio/wav') || header.includes('audio/x-wav')) ext = 'wav';
      else if (header.includes('image/')) ext = 'jpg';
      else if (header.includes('audio/')) ext = 'webm';
    } else {
      buffer = Buffer.from(dataUrl, 'base64');
    }

    const uniqueName = `upload_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${uniqueName}`;
    return res.json({
      success: true,
      url: publicUrl,
      mediaType: mediaType || (['jpg', 'png', 'webp', 'gif'].includes(ext) ? 'image' : 'voice'),
      filename: uniqueName
    });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to process upload: ' + err.message });
  }
});

// 10. Send Reply from Web Panel to User via Bot (Text, Image, or Voice)
app.post('/api/chat/send', async (req, res) => {
  const { userId, text, mediaUrl, mediaType } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required' });
  }
  if ((!text || text.trim() === '') && !mediaUrl) {
    return res.status(400).json({ success: false, error: 'Message text or media is required' });
  }

  try {
    const record = await sendMessageToUser(userId, (text || '').trim(), mediaUrl || '', mediaType || 'text');
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌ Error sending message from web chat:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Mark messages as read
app.post('/api/chat/read/:userId', async (req, res) => {
  const { userId } = req.params;
  await db.markMessagesRead(userId);
  res.json({ success: true });
});

// ----------------- START SERVER -----------------
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n====================================================');
  console.log(`🌐 Multi-Channel Tracking Panel is LIVE at:`);
  console.log(`👉 Port: ${PORT}`);
  console.log('====================================================\n');

  // Initialize Telegram Bot(s)
  initBot();
});
