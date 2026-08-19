const axios = require('axios');
const crypto = require('crypto');

/**
 * Helper to SHA-256 hash strings (required by Meta Conversions API for user data)
 */
function hashData(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Send Lead conversion event to Meta Conversions API (CAPI)
 * Supports per-channel pixel/token or fallback to master .env credentials
 * 
 * @param {Object} params
 * @param {string|number} params.userId - Telegram User ID
 * @param {string} [params.param] - Deep link parameter from /start (e.g. ad id, fbclid, channel tag)
 * @param {string} [params.firstName] - Telegram user first name
 * @param {string} [params.lastName] - Telegram user last name
 * @param {string} [params.username] - Telegram username
 * @param {string} [params.customPixelId] - Optional per-channel Pixel ID
 * @param {string} [params.customAccessToken] - Optional per-channel Access Token
 * @param {string} [params.channelName] - Channel name for metadata
 */
async function sendMetaCapiLead({
  userId,
  param,
  firstName,
  lastName,
  username,
  customPixelId,
  customAccessToken,
  channelName
}) {
  const pixelId = (customPixelId && customPixelId.trim()) || process.env.META_PIXEL_ID || '';
  const accessToken = (customAccessToken && customAccessToken.trim()) || process.env.META_ACCESS_TOKEN || '';
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const testEventCode = process.env.META_TEST_EVENT_CODE || '';

  if (!pixelId || !accessToken) {
    console.log(`ℹ️ [Meta CAPI] Skipped: No Pixel ID or Access Token configured for channel "${channelName || 'Direct'}" (User: ${userId})`);
    return { success: false, reason: 'No Meta Pixel / Access Token configured for this channel', skipped: true };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;

  // Prepare user_data for Maximum Event Match Quality in Meta Ads
  const userData = {
    external_id: [hashData(userId ? String(userId) : 'unknown_user')],
    country: [hashData('in')]
  };

  if (firstName) {
    userData.fn = [hashData(firstName)];
  }
  if (lastName) {
    userData.ln = [hashData(lastName)];
  }

  // If a Click ID or Ad ID was passed in /start
  let extractedAdId = null;
  if (param) {
    let extractedFbclid = null;

    if (param.startsWith('fb_') || param.startsWith('fbclid_') || param.length > 25) {
      extractedFbclid = param.replace(/^fbclid_|^fb_/, '');
    } else if (param.includes('_')) {
      const parts = param.split('_');
      const suffix = parts.slice(1).join('_');
      if (suffix.startsWith('fb_') || suffix.startsWith('fbclid_') || suffix.length > 20) {
        extractedFbclid = suffix.replace(/^fbclid_|^fb_/, '');
      } else if (/^\d{8,}$/.test(suffix)) {
        extractedAdId = suffix;
      }
    } else if (/^\d{8,}$/.test(param)) {
      extractedAdId = param;
    }

    if (extractedFbclid) {
      userData.fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${extractedFbclid}`;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const eventId = `lead_${userId || 'user'}_${now}`;
  const botUser = process.env.TELEGRAM_BOT_USERNAME || 'southboookbot';
  const sourceUrl = `https://t.me/${botUser}?start=${encodeURIComponent(param || 'ad1')}`;

  const pageViewEvent = {
    event_name: 'PageView',
    event_time: now,
    event_id: `pv_${eventId}`,
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: userData,
    custom_data: {
      page_title: channelName || 'Telegram Ad Channel',
      start_param: param || 'none',
      ad_id: extractedAdId || undefined
    }
  };

  const leadEvent = {
    event_name: 'Lead',
    event_time: now,
    event_id: eventId,
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: userData,
    custom_data: {
      currency: 'INR',
      value: 1.00,
      content_name: channelName || 'Telegram Ad Lead',
      content_category: 'Lead',
      lead_source: 'Telegram Multi-Channel Bot',
      channel_name: channelName || 'Default',
      telegram_username: username ? `@${username}` : undefined,
      start_param: param || 'none',
      ad_id: extractedAdId || undefined
    }
  };

  const payload = {
    data: [pageViewEvent, leadEvent],
    access_token: accessToken
  };

  // Only attach test_event_code if explicitly set in .env for debugging
  if (testEventCode && testEventCode.trim() !== '') {
    payload.test_event_code = testEventCode.trim();
  }

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = {
      success: true,
      eventsReceived: response.data.events_received,
      traceId: response.data.fbtrace_id
    };

    console.log('✅ [Meta CAPI] Lead event successfully tracked:', result);
    return result;
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('❌ [Meta CAPI Error]:', JSON.stringify(errorDetails, null, 2));
    return {
      success: false,
      error: errorDetails,
      traceId: error.response?.data?.error?.fbtrace_id || ''
    };
  }
}

module.exports = {
  sendMetaCapiLead
};
