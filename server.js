require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { initBot, registerChannelBot, sendMessageToUser, setEventBroadcaster } = require('./bot');
const { sendMetaCapiLead } = require('./metaCapi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// 1. Get Dashboard Stats
app.get('/api/stats', (req, res) => {
  const stats = db.getStats();
  res.json({ success: true, data: stats });
});

// 2. Get Leads (with optional search/filter)
app.get('/api/leads', (req, res) => {
  const limit = parseInt(req.query.limit) || 150;
  const channel = req.query.channel;
  const search = (req.query.search || '').toLowerCase();

  let leads = db.getLeads(500);

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
app.get('/api/channels', (req, res) => {
  const channels = db.getChannels();
  res.json({ success: true, data: channels });
});

// 4. Create / Update Channel
app.post('/api/channels', (req, res) => {
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

  const saved = db.saveChannel({
    tag,
    name: name || `Account ${tag}`,
    botUsername: req.body.botUsername ? req.body.botUsername.replace(/^@/, '').trim() : '',
    link: cleanLink,
    buttonText,
    welcomeMessage,
    pixelId,
    accessToken,
    botToken: botToken ? botToken.trim() : ''
  });

  // Dynamically start new bot instance if a custom bot token was added
  if (saved.botToken) {
    registerChannelBot(saved);
  }

  res.json({ success: true, data: saved });
});

// 5. Delete Channel
app.delete('/api/channels/:tag', (req, res) => {
  const { tag } = req.params;
  db.deleteChannel(tag);
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

  const lead = db.addLead({
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
app.get('/api/export', (req, res) => {
  const leads = db.getLeads(5000);
  let csv = 'ID,Date Time,Telegram User ID,Name,Username,Channel Tag,Channel Name,Start Param,Meta CAPI Status,Trace ID\n';

  for (const l of leads) {
    const fullName = `"${(l.firstName + ' ' + l.lastName).trim().replace(/"/g, '""')}"`;
    const username = l.username ? `@${l.username}` : 'N/A';
    const channelName = `"${(l.channelName || '').replace(/"/g, '""')}"`;
    const param = `"${(l.rawParam || '').replace(/"/g, '""')}"`;

    csv += `${l.id},"${l.createdAt}",${l.userId},${fullName},${username},${l.channelTag},${channelName},${param},${l.capiStatus},"${l.capiTraceId}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.csv`);
  res.send(csv);
});

// ----------------- LIVE CHAT INBOX API -----------------

// 8. Get All Conversations (WhatsApp-style Contact List)
app.get('/api/chat/conversations', (req, res) => {
  const convs = db.getConversations();
  res.json({ success: true, data: convs });
});

// 9. Get Messages for a specific User
app.get('/api/chat/messages/:userId', (req, res) => {
  const { userId } = req.params;
  const messages = db.getMessagesByUser(userId, 200);
  db.markMessagesRead(userId);
  res.json({ success: true, data: messages });
});

// 10. Send Reply from Web Panel to User via Bot
app.post('/api/chat/send', async (req, res) => {
  const { userId, text } = req.body;
  if (!userId || !text || text.trim() === '') {
    return res.status(400).json({ success: false, error: 'User ID and message text are required' });
  }

  try {
    const record = await sendMessageToUser(userId, text.trim());
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌ Error sending message from web chat:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Mark messages as read
app.post('/api/chat/read/:userId', (req, res) => {
  const { userId } = req.params;
  db.markMessagesRead(userId);
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
