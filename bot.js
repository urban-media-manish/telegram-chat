require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
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

    // Channel Matching Logic - 100% Dynamic for ANY Bot
    let matchedChannel = specificChannel;
    const channels = db.getChannels();
    if (!matchedChannel) {
      if (rawParam) {
        if (rawParam.toLowerCase().startsWith('meta_ad')) {
          matchedChannel = channels.find(c => c.tag === 'ad1') || channels[0];
        } else {
          matchedChannel = channels.find(c => 
            rawParam.toLowerCase() === c.tag.toLowerCase() ||
            rawParam.toLowerCase().startsWith(c.tag.toLowerCase() + '_') ||
            rawParam.toLowerCase().startsWith(c.tag.toLowerCase() + '-')
          );
        }
      }
      // Fallback: If no start param, match the designated primary bot channel or ad1 (South Boook)
      if (!matchedChannel) {
        matchedChannel = channels.find(c => c.tag === 'ad1') ||
                         channels.find(c => c.botUsername && c.botUsername.toLowerCase() === 'southboookbot') ||
                         channels[0];
      }
    }

    const channelTag = matchedChannel ? matchedChannel.tag : (rawParam || 'ad1');
    const channelName = matchedChannel ? matchedChannel.name : 'South Boook';
    const displayParam = rawParam || channelTag;

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
      rawParam: rawParam || channelTag,
      capiStatus: capiResult.skipped ? 'skipped' : (capiResult.success ? 'success' : 'failed'),
      capiTraceId: capiResult.traceId || '',
      capiError: capiResult.error || (capiResult.skipped ? 'Missing Meta credentials' : null)
    });

    console.log(`💾 [Lead Stored] ID: ${leadRecord.id}, Channel: ${channelName}, CAPI: ${leadRecord.capiStatus}`);
    notifyRealtime({ type: 'new_lead', lead: leadRecord });

    // Welcome Message (Direct in-bot chat greeting)
    const DEFAULT_WELCOME_MESSAGE = `🔥 WELCOME TO INDIA'S TRUSTED PLATFORM 🔥\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💎 ACCESS OUR PREMIUM PARTNER PLATFORMS 💎\n\n` +
      `👇 Choose Any Platform & Get Started 👇\n\n` +
      `🏆 TRUSTED & ESTABLISHED NETWORK 🏆\n\n` +
      `🔶 SOUTHBOOK\n` +
      `♠️ https://Southbook.win\n` +
      `APP :- https://mythemedata.com/apk/Southbook.win.apk\n\n` +
      `🔶 REDDYANNA\n` +
      `♠️ www.xreddyanna1.com\n\n` +
      `🔶 LOTUS365\n` +
      `♠️ www.lotus365x.vip\n\n` +
      `🔶 FAIRPLAY\n` +
      `♠️ www.fairplayx.club\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⚡ Quick ID Activation\n` +
      `⚡ Fast Deposit & Withdrawal Support\n` +
      `⚡ 24×7 Customer Assistance\n` +
      `⚡ Personal Guidance Available\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📞 OFFICIAL SUPPORT DESK\n\n` +
      `💬 WhatsApp Support Available 24×7\n` +
      `https://wa.link/fairplayx\n` +
      `https://wa.link/lotusx\n` +
      `https://wa.link/reddyx\n` +
      `https://wa.link/southbook\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🏆 Trusted Service\n` +
      `⚡ Fast Support\n` +
      `📲 Instant Assistance`;

    let welcomeText = (matchedChannel && matchedChannel.welcomeMessage && matchedChannel.welcomeMessage.length > 50)
      ? matchedChannel.welcomeMessage
      : DEFAULT_WELCOME_MESSAGE;

    try {
      await bot.sendMessage(chatId, welcomeText, {
        disable_web_page_preview: true
      });

      await db.saveMessage({
        userId: user.id,
        userChatId: chatId,
        sender: 'admin',
        userName: channelName || 'Support Bot',
        text: welcomeText,
        botToken: botToken,
        channelTag: channelTag
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

  // 3.5 Handle Telegram Channel "Request to Join" (1-Second Auto-Approval + Meta CAPI — Zero DM)
  bot.on('chat_join_request', async (joinReq) => {
    const user = joinReq.from;
    const chat = joinReq.chat;
    const inviteLink = joinReq.invite_link;
    const inviteLinkName = inviteLink?.name || '';
    const inviteUrl = inviteLink?.invite_link || '';

    console.log(`\n⚡ [Channel Join Request] User: ${user.id} (@${user.username || 'none'}), Channel: "${chat.title}" (${chat.id})`);

    // 1. Instant 1-Second Auto-Approval into the Channel
    try {
      await bot.approveChatJoinRequest(chat.id, user.id);
      console.log(`✅ [1-Sec Auto-Approved] User ${user.id} approved into "${chat.title}"!`);
    } catch (approveErr) {
      console.error(`❌ Failed to auto-approve join request:`, approveErr.message);
    }

    // 2. Channel & Pixel Matching Logic
    const channels = db.getChannels();
    let matchedChannel = specificChannel;

      if (inviteLinkName) {
        matchedChannel = channels.find(c =>
          inviteLinkName.toLowerCase() === c.tag.toLowerCase() ||
          inviteLinkName.toLowerCase().startsWith(c.tag.toLowerCase() + '_') ||
          inviteLinkName.toLowerCase().startsWith(c.tag.toLowerCase() + '-')
        );
      }
      if (!matchedChannel && inviteUrl) {
        matchedChannel = channels.find(c => c.link && (c.link.includes(inviteUrl) || inviteUrl.includes(c.link)));
      }
      if (!matchedChannel) {
        matchedChannel = channels.find(c => c.destinationType === 'channel' && c.name && c.name.toLowerCase() === (chat.title || '').toLowerCase()) ||
                         channels.find(c => c.name && c.name.toLowerCase() === (chat.title || '').toLowerCase());
      }
      if (!matchedChannel && botToken) {
        const cleanTok = String(botToken).trim();
        const tokPrefix = cleanTok.split(':')[0];
        matchedChannel = channels.find(c => c.destinationType === 'channel' && c.botToken && c.botToken.trim() === cleanTok) ||
                         channels.find(c => c.destinationType === 'channel' && c.botToken && c.botToken.startsWith(tokPrefix)) ||
                         channels.find(c => c.destinationType === 'channel') ||
                         channels.find(c => c.botToken && c.botToken.trim() === cleanTok);
      }
      if (!matchedChannel) {
        matchedChannel = channels.find(c => c.destinationType === 'channel') || channels[0];
      }

    const channelTag = matchedChannel ? matchedChannel.tag : (inviteLinkName || 'channel_join');
    const channelName = matchedChannel ? matchedChannel.name : (chat.title || 'Telegram Channel');
    const rawParam = inviteLinkName || `join_${chat.id}`;

    // 3. Send Subscribe conversion to Meta Conversions API (CAPI)
    const capiResult = await sendMetaCapiLead({
      userId: user.id,
      param: rawParam,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      customPixelId: matchedChannel?.pixelId,
      customAccessToken: matchedChannel?.accessToken,
      channelName: channelName,
      eventName: 'Subscribe'
    });

    // 4. Record Subscriber Lead into Database
    const leadRecord = await db.addLead({
      userId: user.id,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      username: user.username || '',
      languageCode: user.language_code || 'en',
      channelTag: channelTag,
      channelName: channelName,
      rawParam: rawParam,
      joinType: 'channel_join',
      capiStatus: capiResult.skipped ? 'skipped' : (capiResult.success ? 'success' : 'failed'),
      capiTraceId: capiResult.traceId || '',
      capiError: capiResult.error || (capiResult.skipped ? 'Missing Meta credentials' : null)
    });

    console.log(`💾 [Channel Subscriber Stored] ID: ${leadRecord.id}, Channel: ${channelName}, CAPI: ${leadRecord.capiStatus}`);
    notifyRealtime({ type: 'new_lead', lead: leadRecord, joinType: 'channel_join' });

    // 5. Notify Admin Helpdesk / Group
    const adminConfig = db.getAdminConfig();
    if (adminConfig.adminChatId) {
      const adminNotice = `⚡ <b>New Channel Subscriber Auto-Approved!</b> 🎯\n\n` +
        `👤 <b>User:</b> ${user.first_name || ''} ${user.last_name || ''} (@${user.username || 'none'})\n` +
        `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
        `📢 <b>Channel:</b> ${chat.title || channelName}\n` +
        `🏷️ <b>Tag:</b> <code>${channelTag}</code>\n` +
        `⚡ <b>Meta CAPI:</b> ${leadRecord.capiStatus === 'success' ? '✅ Synced' : '⚠️ ' + leadRecord.capiStatus}`;

      try {
        await bot.sendMessage(adminConfig.adminChatId, adminNotice, { parse_mode: 'HTML' });
      } catch (err) {}
    }
  });

  // 3.6 Handle Channel Member Leave / Status Update (Retention Tracking)
  bot.on('chat_member', async (memberUpdate) => {
    try {
      const oldStatus = memberUpdate.old_chat_member?.status;
      const newStatus = memberUpdate.new_chat_member?.status;
      const user = memberUpdate.new_chat_member?.user || memberUpdate.from;
      const chat = memberUpdate.chat;

      if ((newStatus === 'left' || newStatus === 'kicked') && (oldStatus === 'member' || oldStatus === 'administrator')) {
        console.log(`👋 [Channel Member Left] User ${user.id} (@${user.username || 'none'}) left "${chat.title || 'Channel'}"`);
        await db.markLeadLeft(user.id, chat.id);
      }
    } catch (err) {}
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

        const savedTopicAdminMsg = await db.saveMessage({
          userId: userRecord.userId,
          userChatId: userRecord.userChatId,
          sender: 'admin',
          userName: 'Admin',
          text: msg.text || '[Media]',
          botToken: userRecord.botToken,
          channelTag: userRecord.channelTag || 'default'
        });

        notifyRealtime({ type: 'new_message', message: savedTopicAdminMsg, userId: userRecord.userId });
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
          botToken: replyTarget.botToken,
          channelTag: replyTarget.channelTag || 'default'
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
      const userLead = existingLeads.find(l => String(l.userId) === String(user.id));
      let matchedChannel = specificChannel;
      if (!matchedChannel && userLead && userLead.channelTag) {
        matchedChannel = channels.find(c => c.tag.toLowerCase() === userLead.channelTag.toLowerCase());
      }
      if (!matchedChannel && botToken) {
        const cleanTok = String(botToken).trim();
        const tokPrefix = cleanTok.split(':')[0];
        matchedChannel = channels.find(c => c.botToken && c.botToken.trim() === cleanTok) ||
                         channels.find(c => c.botToken && c.botToken.startsWith(tokPrefix));
      }

      const chTag = matchedChannel ? matchedChannel.tag : (userLead ? userLead.channelTag : 'default');
      const chName = matchedChannel ? matchedChannel.name : (userLead ? userLead.channelName : 'Direct Chat');

      const isLeadRecorded = existingLeads.some(l => String(l.userId) === String(user.id) && l.channelTag === chTag);
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

      let msgType = 'text';
      let mediaUrl = '';
      let mediaType = '';
      let textContent = msg.text || '';

      if (msg.photo && msg.photo.length > 0) {
        msgType = 'image';
        mediaType = 'image';
        textContent = msg.caption || '';
        try {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          mediaUrl = await bot.getFileLink(fileId);
        } catch (e) {
          console.warn('⚠️ Could not get photo file link:', e.message);
        }
      } else if (msg.voice) {
        msgType = 'voice';
        mediaType = 'voice';
        textContent = msg.caption || '';
        try {
          mediaUrl = await bot.getFileLink(msg.voice.file_id);
        } catch (e) {
          console.warn('⚠️ Could not get voice file link:', e.message);
        }
      } else if (msg.audio) {
        msgType = 'audio';
        mediaType = 'audio';
        textContent = msg.audio.title || msg.caption || '';
        try {
          mediaUrl = await bot.getFileLink(msg.audio.file_id);
        } catch (e) {
          console.warn('⚠️ Could not get audio file link:', e.message);
        }
      }

      const savedUserMsg = await db.saveMessage({
        userId: user.id,
        userChatId: chatId,
        sender: 'user',
        userName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User ' + user.id,
        userUsername: user.username || '',
        text: textContent,
        type: msgType,
        mediaUrl: mediaUrl,
        mediaType: mediaType,
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
    } else if (
      error.code === 'ECONNRESET' ||
      (error.message && (
        error.message.includes('connection reset by peer') ||
        error.message.includes('stream reading error') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('socket hang up') ||
        error.message.includes('ETIMEDOUT')
      ))
    ) {
      // Network blip — transient error, bot will auto-retry. Ignore silently.
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
        interval: 300,
        autoStart: true,
        params: {
          timeout: 20,
          allowed_updates: [
            'message',
            'edited_message',
            'callback_query',
            'chat_join_request',
            'chat_member',
            'my_chat_member'
          ]
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

async function sendMessageToUser(targetKey, text = '', mediaUrl = '', mediaType = 'text') {
  let userId = String(targetKey);
  let forcedBotToken = '';
  let targetChannelTag = 'default';

  if (userId.includes('_')) {
    const idx = userId.indexOf('_');
    const targetUid = userId.slice(0, idx);
    const botPrefixOrTag = userId.slice(idx + 1).toLowerCase().trim();
    userId = targetUid;

    const channels = db.getChannels();
    const matchedChan = channels.find(c => 
      (c.tag && c.tag.toLowerCase() === botPrefixOrTag) ||
      (c.botUsername && c.botUsername.toLowerCase().replace(/^@/, '') === botPrefixOrTag) ||
      (c.botToken && c.botToken.startsWith(botPrefixOrTag))
    );

    if (matchedChan) {
      targetChannelTag = matchedChan.tag;
      if (matchedChan.botToken) forcedBotToken = matchedChan.botToken.trim();
    } else {
      for (const tok of activeBots.keys()) {
        if (tok.startsWith(botPrefixOrTag)) {
          forcedBotToken = tok;
          break;
        }
      }
    }
  }

  const MASTER_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '8822712824:AAGTvplfF7sj2JVZjzL6KF382_mHkHAOyCY').trim();

  // Ensure at least master bot is active
  if (!activeBots.has(MASTER_TOKEN)) {
    startBotInstance(MASTER_TOKEN);
  }

  const leads = db.getLeads(500);
  const lead = leads.find(l => String(l.userId) === String(userId));

  // Prefer numeric positive user Telegram ID
  let userChatId = lead?.userId || userId;
  if (String(userChatId).startsWith('-')) {
    userChatId = userId;
  }

  const messages = await db.getMessagesByUser(targetKey, 50);
  const lastMsg = messages.slice().reverse().find(m => m.botToken);
  let botToken = forcedBotToken || lastMsg?.botToken || '';

  // Candidates list of bots to attempt in order
  const botsToTry = [];
  if (botToken && activeBots.has(botToken)) {
    botsToTry.push({ token: botToken, bot: activeBots.get(botToken) });
  }

  for (const [tok, botInst] of activeBots.entries()) {
    if (!botsToTry.some(b => b.token === tok)) {
      botsToTry.push({ token: tok, bot: botInst });
    }
  }

  if (botsToTry.length === 0) {
    startBotInstance(MASTER_TOKEN);
    if (activeBots.has(MASTER_TOKEN)) {
      botsToTry.push({ token: MASTER_TOKEN, bot: activeBots.get(MASTER_TOKEN) });
    }
  }

  if (botsToTry.length === 0) {
    throw new Error('Telegram bot is starting up. Please try again in a few seconds.');
  }

  let sendSuccess = false;
  let lastError = null;
  let successfulBotToken = botToken || MASTER_TOKEN;

  let permanentUrl = '';

  for (const candidate of botsToTry) {
    try {
      if (mediaType === 'image' && mediaUrl) {
        let imageSource = mediaUrl;
        if (mediaUrl.startsWith('/uploads/')) {
          const localPath = path.join(__dirname, 'public', mediaUrl);
          if (fs.existsSync(localPath)) {
            imageSource = fs.createReadStream(localPath);
          }
        }
        const sentMsg = await candidate.bot.sendPhoto(userChatId, imageSource, { caption: text || undefined });
        if (sentMsg && sentMsg.photo && sentMsg.photo.length > 0) {
          const fileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
          try {
            permanentUrl = await candidate.bot.getFileLink(fileId);
          } catch (e) {}
        }
      } else if ((mediaType === 'voice' || mediaType === 'audio') && mediaUrl) {
        let audioSource = mediaUrl;
        if (mediaUrl.startsWith('/uploads/')) {
          const localPath = path.join(__dirname, 'public', mediaUrl);
          if (fs.existsSync(localPath)) {
            audioSource = fs.createReadStream(localPath);
          }
        }
        try {
          const sentMsg = await candidate.bot.sendVoice(userChatId, audioSource, { caption: text || undefined });
          if (sentMsg && sentMsg.voice) {
            try {
              permanentUrl = await candidate.bot.getFileLink(sentMsg.voice.file_id);
            } catch (e) {}
          }
        } catch (voiceErr) {
          console.warn('⚠️ sendVoice fallback to sendAudio:', voiceErr.message);
          if (mediaUrl.startsWith('/uploads/')) {
            const localPath = path.join(__dirname, 'public', mediaUrl);
            if (fs.existsSync(localPath)) {
              audioSource = fs.createReadStream(localPath);
            }
          }
          const sentMsg = await candidate.bot.sendAudio(userChatId, audioSource, { title: 'Voice Note' });
          if (sentMsg && sentMsg.audio) {
            try {
              permanentUrl = await candidate.bot.getFileLink(sentMsg.audio.file_id);
            } catch (e) {}
          }
        }
      } else {
        await candidate.bot.sendMessage(userChatId, text);
      }

      successfulBotToken = candidate.token;
      sendSuccess = true;
      console.log(`📤 [Live Chat Delivered] Sent ${mediaType} to User ${userChatId} via Bot [${candidate.token.slice(0, 10)}...]: "${text || mediaUrl}"`);
      break;
    } catch (tgErr) {
      lastError = tgErr;
      console.warn(`⚠️ Telegram send attempt failed via Bot [${candidate.token.slice(0, 10)}...]:`, tgErr.message);
      // If error is not "chat not found", don't loop needlessly
      if (!tgErr.message.includes('chat not found') && !tgErr.message.includes('400')) {
        break;
      }
    }
  }

  if (!sendSuccess) {
    const isChatNotFound = lastError && lastError.message && lastError.message.includes('chat not found');
    if (isChatNotFound) {
      throw new Error(`Telegram chat not found for User ID ${userChatId}. If this is a fake/simulated test lead, Telegram cannot message simulated IDs. Real users must start (/start) the bot on Telegram first.`);
    }
    throw new Error(`Telegram Delivery: ${lastError ? lastError.message : 'Unknown delivery error'}`);
  }

  // Save to DB with Permanent Cloud CDN URL
  const finalMediaUrl = permanentUrl || mediaUrl || '';
  const record = await db.saveMessage({
    userId: userId,
    userChatId: userChatId,
    sender: 'admin',
    userName: 'Admin',
    text: text || '',
    type: mediaType || (finalMediaUrl ? (mediaType || 'image') : 'text'),
    mediaUrl: finalMediaUrl,
    mediaType: mediaType || '',
    botToken: successfulBotToken,
    channelTag: targetChannelTag || lead?.channelTag || 'default'
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

