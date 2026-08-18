require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { sendMetaCapiLead } = require('./metaCapi');
const db = require('./db');

// Map of active bot instances: token -> botInstance
const activeBots = new Map();
let realTimeBroadcaster = null;

function setEventBroadcaster(fn) {
  realTimeBroadcaster = fn;
}

function notifyRealtime(event) {
  if (realTimeBroadcaster) {
    try { realTimeBroadcaster(event); } catch (e) {}
  }
}

async function getOrCreateUserTopic(bot, adminChatId, user, channelName, channelTag, botToken, userChatId) {
  let userTopic = db.getUserTopic(user.id);

  if (!userTopic || !userTopic.threadId) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';
    const handle = user.username ? `@${user.username}` : `ID ${user.id}`;
    const topicTitle = `${fullName} (${handle})`.slice(0, 120);

    try {
      const topic = await bot.createForumTopic(adminChatId, topicTitle);
      userTopic = await db.saveUserTopic(user.id, {
        threadId: topic.message_thread_id,
        userChatId: userChatId,
        userName: fullName,
        userUsername: user.username || '',
        botToken: botToken,
        channelTag: channelTag
      });

      const introMsg = `🚀 <b>New Customer Started Chat!</b>\n\n` +
        `👤 <b>Name:</b> ${fullName} (@${user.username || 'none'})\n` +
        `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
        `🏷️ <b>Channel/Ad:</b> ${channelName} (<code>${channelTag}</code>)\n\n` +
        `💬 <i>All messages from ${fullName} will arrive right here.\n👉 Simply type and send messages below to chat with this customer directly!</i>`;

      await bot.sendMessage(adminChatId, introMsg, {
        parse_mode: 'HTML',
        message_thread_id: topic.message_thread_id
      });
      console.log(`📁 [Forum Topic Created] "${topicTitle}" (Thread ID: ${topic.message_thread_id}) for User ${user.id}`);
    } catch (err) {
      console.error('❌ Failed to create Forum Topic:', err.message);
      return null;
    }
  } else {
    // Keep userChatId / botToken synced
    if (userTopic.userChatId !== userChatId || userTopic.botToken !== botToken) {
      userTopic.userChatId = userChatId;
      userTopic.botToken = botToken;
      await db.saveUserTopic(user.id, userTopic);
    }
  }

  return userTopic;
}

function attachBotListeners(bot, specificChannel = null, botToken = '') {
  // 1. Handle /setadmin command from admin
  bot.onText(/\/setadmin/, async (msg) => {
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === 'supergroup' || msg.chat.type === 'group';
    const isForum = isGroup || String(chatId).startsWith('-100');
    const username = msg.from.username || msg.from.first_name || 'Admin';

    await db.setAdminChatId(chatId, username, isForum);
    console.log(`👑 [Admin Connected] Chat ID: ${chatId} (Forum: ${isForum})`);

    try {
      if (isForum) {
        await bot.sendMessage(chatId, `👑 <b>Telegram Topics Forum Mode Connected!</b>\n\n` +
          `✅ This Group is now linked as your <b>Live Support Helpdesk</b>.\n\n` +
          `📁 <b>WhatsApp-style Separate Rooms:</b> Every customer who messages the bot will automatically get their own <b>Dedicated Topic / Tab</b> in this group!\n\n` +
          `💬 <b>How to reply:</b> Just open any customer's topic and type normally—it will be delivered directly to them!`, {
          parse_mode: 'HTML'
        });
      } else {
        await bot.sendMessage(chatId, `👑 <b>Admin Connected Successfully!</b>\n\n` +
          `✅ Your Telegram account is now linked as the <b>Master Live Support Agent</b>.\n\n` +
          `📥 All messages sent by users on your bot(s) will be forwarded here in real-time.\n` +
          `💬 To reply to any user, simply <b>Swipe / Reply</b> to their forwarded message and type your response!`, {
          parse_mode: 'HTML'
        });
      }
    } catch (err) {
      console.error('Error sending admin confirmation:', err.message);
    }
  });

  // 2. Handle /myid or /status command
  bot.onText(/\/myid|\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const adminConfig = db.getAdminConfig();
    const isAdmin = String(adminConfig.adminChatId) === String(chatId);
    const stats = db.getStats();

    let text = `🆔 <b>Your Chat ID:</b> <code>${chatId}</code>\n` +
               `👤 <b>Username:</b> @${msg.from.username || 'none'}\n` +
               `👑 <b>Admin Status:</b> ${isAdmin ? '✅ Active Admin' : '❌ Not Set'}\n` +
               `📁 <b>Forum Topics Mode:</b> ${adminConfig.isForum ? '✅ Active' : '❌ 1-on-1'}\n\n` +
               `📊 <b>Today Leads:</b> ${stats.todayLeads}\n` +
               `👥 <b>Total Leads:</b> ${stats.totalLeads}\n` +
               `⚡ <b>Meta CAPI Synced:</b> ${stats.successfulCapi}`;

    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {}
  });

  // 3. Handle /start command (New Lead Tracking & Welcome)
  bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    const rawParam = match && match[1] ? match[1].trim() : '';

    console.log(`\n📥 [Incoming User] ID: ${user.id} (@${user.username || 'N/A'}), Param: "${rawParam || 'none'}"`);

    // Channel Matching Logic
    let matchedChannel = specificChannel;
    if (!matchedChannel) {
      const channels = db.getChannels();
      if (rawParam) {
        matchedChannel = channels.find(c => 
          rawParam.toLowerCase() === c.tag.toLowerCase() ||
          rawParam.toLowerCase().startsWith(c.tag.toLowerCase() + '_') ||
          rawParam.toLowerCase().startsWith(c.tag.toLowerCase() + '-')
        );
      }
      if (!matchedChannel && botToken) {
        matchedChannel = channels.find(c => c.botToken && c.botToken.trim() === String(botToken).trim());
      }
    }

    const isManishBot = botToken && String(botToken).startsWith('8827730708');
    const channelTag = matchedChannel ? matchedChannel.tag : (isManishBot ? 'vip' : (rawParam || 'default'));
    const channelName = matchedChannel ? matchedChannel.name : (isManishBot ? 'VIP Direct Support Chat' : 'Southboookbot');

    // Send Lead to Meta Conversions API (CAPI)
    const capiResult = await sendMetaCapiLead({
      userId: user.id,
      param: rawParam,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      customPixelId: matchedChannel?.pixelId,
      customAccessToken: matchedChannel?.accessToken,
      channelName: channelName
    });

    // Record Lead into Local Database
    const leadRecord = await db.addLead({
      userId: user.id,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      username: user.username || '',
      languageCode: user.language_code || 'en',
      channelTag: channelTag,
      channelName: channelName,
      rawParam: rawParam,
      capiStatus: capiResult.skipped ? 'skipped' : (capiResult.success ? 'success' : 'failed'),
      capiTraceId: capiResult.traceId || '',
      capiError: capiResult.error || (capiResult.skipped ? 'Missing Meta credentials' : null)
    });

    console.log(`💾 [Lead Stored] ID: ${leadRecord.id}, Channel: ${channelName}, CAPI: ${leadRecord.capiStatus}`);
    notifyRealtime({ type: 'new_lead', lead: leadRecord });

    // Welcome Message (Direct in-bot chat greeting)
    let welcomeText = '';
    if (matchedChannel && matchedChannel.welcomeMessage) {
      welcomeText = matchedChannel.welcomeMessage;
    } else {
      welcomeText = `👋 **Welcome, ${user.first_name || 'there'}!**\n\n` +
                    `🔥 Thank you for reaching out to us!\n\n` +
                    `💬 **We are online right now.** Type and send your message below, and our team will answer you directly here! 👇`;
    }

    try {
      await bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown'
      });
    } catch (sendErr) {
      console.error('❌ Failed to send Telegram welcome message:', sendErr.message);
    }

    // Auto-create Forum Topic for user if Forum Mode is active
    const adminConfig = db.getAdminConfig();
    if (adminConfig.adminChatId && String(adminConfig.adminChatId) !== String(chatId)) {
      if (adminConfig.isForum) {
        await getOrCreateUserTopic(bot, adminConfig.adminChatId, user, channelName, channelTag, botToken, chatId);
      } else {
        // Fallback 1-on-1 notification
        const adminNotice = `🚀 <b>New Lead Started Bot!</b>\n\n` +
          `👤 <b>Name:</b> ${user.first_name || ''} ${user.last_name || ''} (@${user.username || 'none'})\n` +
          `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
          `🏷️ <b>Channel/Ad:</b> ${channelName} (<code>${channelTag}</code>)\n` +
          `⚡ <b>Meta CAPI:</b> ${leadRecord.capiStatus === 'success' ? '✅ Tracked' : '⚠️ ' + leadRecord.capiStatus}\n\n` +
          `<i>💬 Waiting for user's message...</i>`;

        try {
          const adminMsg = await bot.sendMessage(adminConfig.adminChatId, adminNotice, { parse_mode: 'HTML' });
          db.saveReplyMapping(adminMsg.message_id, {
            userChatId: chatId,
            userId: user.id,
            botToken: botToken,
            userName: user.first_name || 'User'
          });
        } catch (err) {}
      }
    }
  });

  // 4. Handle incoming user messages & admin replies
  bot.on('message', async (msg) => {
    if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/setadmin') || msg.text.startsWith('/myid') || msg.text.startsWith('/status'))) {
      return;
    }

    const chatId = msg.chat.id;
    const user = msg.from;
    const adminConfig = db.getAdminConfig();
    const isAdminChat = adminConfig.adminChatId && String(adminConfig.adminChatId) === String(chatId);

    // ==========================================
    // CASE 1: ADMIN SENDS MESSAGE IN FORUM TOPIC
    // ==========================================
    if (isAdminChat && adminConfig.isForum && msg.message_thread_id) {
      const userRecord = db.getUserByTopic(msg.message_thread_id);

      if (!userRecord) {
        return; // General topic or unknown
      }

      const targetBot = activeBots.get(userRecord.botToken) || bot;

      try {
        if (msg.text) {
          await targetBot.sendMessage(userRecord.userChatId, msg.text);
        } else if (msg.photo) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          await targetBot.sendPhoto(userRecord.userChatId, fileId, { caption: msg.caption });
        } else if (msg.voice) {
          await targetBot.sendVoice(userRecord.userChatId, msg.voice.file_id, { caption: msg.caption });
        } else if (msg.document) {
          await targetBot.sendDocument(userRecord.userChatId, msg.document.file_id, { caption: msg.caption });
        } else if (msg.video) {
          await targetBot.sendVideo(userRecord.userChatId, msg.video.file_id, { caption: msg.caption });
        } else if (msg.sticker) {
          await targetBot.sendSticker(userRecord.userChatId, msg.sticker.file_id);
        }

        await db.saveMessage({
          userId: userRecord.userId,
          userChatId: userRecord.userChatId,
          sender: 'admin',
          userName: 'Admin',
          text: msg.text || '[Media]',
          botToken: userRecord.botToken
        });

        console.log(`📤 [Topic Reply Delivered] To User ${userRecord.userId} (${userRecord.userName}): "${msg.text || '[Media]'}"`);
      } catch (err) {
        console.error('❌ Failed to deliver topic message to user:', err.message);
      }
      return;
    }

    // ==========================================
    // CASE 2: ADMIN REPLIES IN 1-ON-1 PRIVATE CHAT
    // ==========================================
    if (isAdminChat && !adminConfig.isForum && msg.reply_to_message) {
      let replyTarget = db.getReplyMapping(msg.reply_to_message.message_id);

      // Smart fallback: parse ID or @username from reply_to_message text
      if (!replyTarget) {
        const replyText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        const idMatch = replyText.match(/ID:\s*([0-9]+)/i);
        const userMatch = replyText.match(/@([a-zA-Z0-9_]+)/i);
        const leads = db.getLeads(500);

        if (idMatch && idMatch[1]) {
          const targetUid = idMatch[1];
          const foundLead = leads.find(l => String(l.userId) === String(targetUid));
          replyTarget = {
            userId: targetUid,
            userChatId: targetUid,
            userName: foundLead ? `${foundLead.firstName || ''} ${foundLead.lastName || ''}`.trim() : `User ${targetUid}`,
            botToken: ''
          };
        } else if (userMatch && userMatch[1]) {
          const targetUsername = userMatch[1].toLowerCase();
          const foundLead = leads.find(l => l.username && l.username.toLowerCase() === targetUsername);
          if (foundLead) {
            replyTarget = {
              userId: foundLead.userId,
              userChatId: foundLead.userId,
              userName: `${foundLead.firstName || ''} ${foundLead.lastName || ''}`.trim() || `@${foundLead.username}`,
              botToken: ''
            };
          }
        }
      }

      if (!replyTarget) {
        return bot.sendMessage(chatId, `⚠️ <i>Could not find which user to reply to. Please reply directly to the forwarded user message card.</i>`, { parse_mode: 'HTML' });
      }

      const targetBot = activeBots.get(replyTarget.botToken) || bot;

      try {
        if (msg.text) {
          await targetBot.sendMessage(replyTarget.userChatId, msg.text);
        } else if (msg.photo) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          await targetBot.sendPhoto(replyTarget.userChatId, fileId, { caption: msg.caption });
        } else if (msg.voice) {
          await targetBot.sendVoice(replyTarget.userChatId, msg.voice.file_id, { caption: msg.caption });
        } else if (msg.document) {
          await targetBot.sendDocument(replyTarget.userChatId, msg.document.file_id, { caption: msg.caption });
        } else if (msg.sticker) {
          await targetBot.sendSticker(replyTarget.userChatId, msg.sticker.file_id);
        }

        const savedAdminMsg = await db.saveMessage({
          userId: replyTarget.userId,
          userChatId: replyTarget.userChatId,
          sender: 'admin',
          userName: 'Admin',
          text: msg.text || '[Media]',
          botToken: replyTarget.botToken
        });

        notifyRealtime({ type: 'new_message', message: savedAdminMsg, userId: replyTarget.userId });
        console.log(`📤 [Admin Replied] Sent to User ${replyTarget.userId} (${replyTarget.userName}): "${msg.text || '[Media]'}"`);

        await bot.sendMessage(chatId, `✅ <b>Delivered to ${escapeHtml(replyTarget.userName || 'User')}</b>`, {
          parse_mode: 'HTML',
          reply_to_message_id: msg.message_id
        });
      } catch (err) {
        console.error('❌ Failed to deliver reply:', err.message);
      }
      return;
    }

    // ==========================================
    // CASE 3: NORMAL USER SENDS MESSAGE TO BOT
    // ==========================================
    if (!isAdminChat) {
      console.log(`💬 [User Message] From ${user.first_name} (ID: ${user.id}): "${msg.text || '[Media]'}"`);

      // Ensure user is recorded in leads if not already
      const existingLeads = db.getLeads(500);
      const channels = db.getChannels();
      let matchedChannel = specificChannel;
      if (!matchedChannel && botToken) {
        matchedChannel = channels.find(c => c.botToken === botToken);
      }

      const isManishBot = botToken && String(botToken).startsWith('8827730708');
      const chTag = matchedChannel ? matchedChannel.tag : (isManishBot ? 'vip' : 'meta_ad');
      const chName = matchedChannel ? matchedChannel.name : (isManishBot ? 'VIP Direct Support Chat' : 'Southboookbot');

      const isLeadRecorded = existingLeads.some(l => String(l.userId) === String(user.id));
      if (!isLeadRecorded) {
        const autoLead = await db.addLead({
          userId: user.id,
          firstName: user.first_name || '',
          lastName: user.last_name || '',
          username: user.username || '',
          languageCode: user.language_code || 'en',
          channelTag: chTag,
          channelName: chName,
          rawParam: chTag,
          capiStatus: 'skipped',
          capiTraceId: '',
          capiError: null
        });
        notifyRealtime({ type: 'new_lead', lead: autoLead });
      }

      const savedUserMsg = await db.saveMessage({
        userId: user.id,
        userChatId: chatId,
        sender: 'user',
        userName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User ' + user.id,
        userUsername: user.username || '',
        text: msg.text || '[Media / Attachment]',
        botToken: botToken,
        channelTag: chTag
      });

      notifyRealtime({ type: 'new_message', message: savedUserMsg, userId: user.id });

      if (adminConfig.adminChatId) {
        // Option A: Send into User's Dedicated Forum Topic
        if (adminConfig.isForum) {
          const userTopic = await getOrCreateUserTopic(bot, adminConfig.adminChatId, user, 'Direct Chat', 'lead', botToken, chatId);

          if (userTopic && userTopic.threadId) {
            try {
              if (msg.text) {
                await bot.sendMessage(adminConfig.adminChatId, msg.text, { message_thread_id: userTopic.threadId });
              } else if (msg.photo) {
                const fileId = msg.photo[msg.photo.length - 1].file_id;
                await bot.sendPhoto(adminConfig.adminChatId, fileId, { caption: msg.caption, message_thread_id: userTopic.threadId });
              } else if (msg.voice) {
                await bot.sendVoice(adminConfig.adminChatId, msg.voice.file_id, { caption: msg.caption, message_thread_id: userTopic.threadId });
              } else if (msg.document) {
                await bot.sendDocument(adminConfig.adminChatId, msg.document.file_id, { caption: msg.caption, message_thread_id: userTopic.threadId });
              } else if (msg.video) {
                await bot.sendVideo(adminConfig.adminChatId, msg.video.file_id, { caption: msg.caption, message_thread_id: userTopic.threadId });
              } else if (msg.sticker) {
                await bot.sendSticker(adminConfig.adminChatId, msg.sticker.file_id, { message_thread_id: userTopic.threadId });
              }
            } catch (topicErr) {
              console.error('❌ Failed to forward to topic:', topicErr.message);
            }
          }
        } else {
          // Option B: Standard 1-on-1 forward card
          const userFullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
          const userHandle = user.username ? `@${user.username}` : 'No username';

          const forwardHeader = `💬 <b>Message from ${userFullName}</b>\n` +
                                `👤 <b>User:</b> ${userHandle} | ID: <code>${user.id}</code>\n` +
                                `──────────────\n` +
                                `${msg.text ? `<b>Text:</b> ${escapeHtml(msg.text)}` : '<i>[Media Attachment]</i>'}\n` +
                                `──────────────\n` +
                                `👉 <i>Swipe & Reply to this message to answer!</i>`;

          try {
            let adminMsg;
            if (msg.text) {
              adminMsg = await bot.sendMessage(adminConfig.adminChatId, forwardHeader, { parse_mode: 'HTML' });
            } else if (msg.photo) {
              const fileId = msg.photo[msg.photo.length - 1].file_id;
              adminMsg = await bot.sendPhoto(adminConfig.adminChatId, fileId, { caption: forwardHeader, parse_mode: 'HTML' });
            } else {
              adminMsg = await bot.sendMessage(adminConfig.adminChatId, forwardHeader, { parse_mode: 'HTML' });
            }

            if (adminMsg) {
              db.saveReplyMapping(adminMsg.message_id, {
                userChatId: chatId,
                userId: user.id,
                botToken: botToken,
                userName: userFullName
              });
            }
          } catch (fwdErr) {
            console.error('❌ Failed to forward user message to admin:', fwdErr.message);
          }
        }
      }
    }
  });

  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('401 Unauthorized')) {
      console.error('\n❌ Telegram Polling Error: Invalid Bot Token.\n');
    } else if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      // 409 conflict happens when another instance or redeploy is starting - ignore silently
    } else {
      console.error('⚠️ Telegram Polling Error:', error.message);
    }
  });

  bot.on('error', (error) => {
    console.error('⚠️ Telegram Bot General Error:', error.message || error);
  });

  bot.on('webhook_error', (error) => {
    console.error('⚠️ Telegram Webhook Error:', error.message || error);
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function startBotInstance(token, specificChannel = null) {
  const cleanToken = token ? token.trim() : '';
  if (!cleanToken || cleanToken === 'your_telegram_bot_token_here' || activeBots.has(cleanToken)) {
    return;
  }

  try {
    const bot = new TelegramBot(cleanToken, {
      polling: {
        interval: 100, // High-speed 100ms instant update
        autoStart: true,
        params: {
          timeout: 5
        }
      }
    });
    attachBotListeners(bot, specificChannel, cleanToken);
    activeBots.set(cleanToken, bot);
    console.log(`🤖 Telegram Bot [${cleanToken.slice(0, 10)}...] is active with Instant Real-Time Polling.`);
  } catch (err) {
    console.error(`❌ Failed to start Bot instance (${cleanToken.slice(0, 10)}...):`, err.message);
  }
}

async function initBot() {
  const masterTokens = [
    process.env.TELEGRAM_BOT_TOKEN,
    '8822712824:AAGTvplfF7sj2JVZjzL6KF382_mHkHAOyCY',
    '8827730708:AAGVUx0Xr9IhZnMSMho2uwTfCP_cSVtjUZk'
  ];

  for (const t of masterTokens) {
    if (t && t.trim() !== '' && t.trim() !== 'your_telegram_bot_token_here') {
      startBotInstance(t.trim());
    }
  }

  try {
    const channels = await db.getChannelsAsync();
    for (const ch of channels) {
      if (ch.botToken && ch.botToken.trim() !== '') {
        startBotInstance(ch.botToken.trim(), ch);
      }
    }
  } catch (err) {
    console.error('Error loading channel bots on startup:', err.message);
  }
}

function registerChannelBot(channel) {
  if (channel.botToken && channel.botToken.trim() !== '') {
    startBotInstance(channel.botToken.trim(), channel);
  }
}

async function sendMessageToUser(userId, text) {
  const MASTER_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '8822712824:AAGTvplfF7sj2JVZjzL6KF382_mHkHAOyCY').trim();

  // Ensure at least master bot is active
  if (!activeBots.has(MASTER_TOKEN)) {
    startBotInstance(MASTER_TOKEN);
  }

  const leads = db.getLeads(500);
  const lead = leads.find(l => String(l.userId) === String(userId));
  
  // Prefer the actual numeric user Telegram ID
  let userChatId = lead?.userId || userId;
  
  // If numeric ID is valid, ensure it is positive for direct user DM
  if (String(userChatId).startsWith('-')) {
    userChatId = userId;
  }

  const messages = await db.getMessagesByUser(userId, 50);
  const lastMsg = messages.slice().reverse().find(m => m.botToken);
  const botToken = lastMsg?.botToken || '';

  let targetBot = (botToken ? activeBots.get(botToken) : null) || activeBots.get(MASTER_TOKEN) || activeBots.values().next().value;
  if (!targetBot) {
    startBotInstance(MASTER_TOKEN);
    targetBot = activeBots.get(MASTER_TOKEN) || activeBots.values().next().value;
  }

  if (!targetBot) {
    throw new Error('Telegram bot is starting up. Please try again in a few seconds.');
  }

  try {
    await targetBot.sendMessage(userChatId, text);
    console.log(`📤 [Live Chat Delivered] Sent message to User ${userChatId}: "${text}"`);
  } catch (tgErr) {
    console.error(`❌ Telegram send error to ${userChatId}:`, tgErr.message);
    throw new Error(`Telegram Delivery: ${tgErr.message}`);
  }

  // Save to DB
  const record = await db.saveMessage({
    userId: userId,
    userChatId: userChatId,
    sender: 'admin',
    userName: 'Admin',
    text: text,
    botToken: botToken || MASTER_TOKEN,
    channelTag: lead?.channelTag || 'default'
  });

  notifyRealtime({ type: 'new_message', message: record, userId: userId });

  // Sync to Admin Telegram as well
  const adminConfig = db.getAdminConfig();
  if (adminConfig.adminChatId && String(adminConfig.adminChatId) !== String(userChatId)) {
    const customerName = lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer' : `User ${userId}`;
    const handle = lead?.username ? `@${lead.username}` : `ID: ${userId}`;
    try {
      const adminSentMsg = await targetBot.sendMessage(adminConfig.adminChatId, `📤 <b>Sent to ${escapeHtml(customerName)} (${handle}):</b>\n💬 ${escapeHtml(text)}`, { parse_mode: 'HTML' });
      if (adminSentMsg) {
        db.saveReplyMapping(adminSentMsg.message_id, {
          userId: userId,
          userChatId: userChatId,
          userName: customerName,
          botToken: botToken || MASTER_TOKEN
        });
      }
    } catch (err) {
      console.warn('Could not sync to admin TG:', err.message);
    }
  }

  return record;
}

module.exports = {
  initBot,
  registerChannelBot,
  sendMessageToUser,
  setEventBroadcaster
};

