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
  const pixelId = customPixelId || process.env.META_PIXEL_ID || '3572072086292080';
  const accessToken = customAccessToken || process.env.META_ACCESS_TOKEN || 'EAAaQv2w9ac0BSOxieaFegNLZCtvkrSCNJ9ABKbTvoiWMyJmXvv5zTNMZAZCIRAUUWQFuFb4twMZCfipshMAlHHroMHPM5u31In9qrtc7MFfPDblZCZCGPvMocqld5yzY4sOiXcywZAJBcy3bJzAxLBb75lD7v3JKLRWiCwTAV0JqKfrUFpZCTxZAB43MRGV8ndgZD';
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const testEventCode = process.env.META_TEST_EVENT_CODE;

  if (!pixelId || !accessToken) {
    console.warn(`⚠️ [Meta CAPI] Skipped: Pixel ID or Access Token is missing for lead (User: ${userId})`);
    return { success: false, reason: 'Missing Meta credentials', skipped: true };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;

  // Prepare user_data
  const userData = {
    external_id: [hashData(userId ? String(userId) : 'unknown_user')]
  };

  if (firstName) {
    userData.fn = [hashData(firstName)];
  }
  if (lastName) {
    userData.ln = [hashData(lastName)];
  }

  // If a Click ID (fbclid) was passed
  if (param) {
    if (param.startsWith('fb_') || param.startsWith('fbclid_') || param.length > 20) {
      const cleanFbclid = param.replace(/^fbclid_|^fb_/, '');
      userData.fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${cleanFbclid}`;
    }
  }

  const eventData = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'other',
    user_data: userData,
    custom_data: {
      lead_source: 'Telegram Multi-Channel Bot',
      channel_name: channelName || 'Default',
      telegram_username: username ? `@${username}` : undefined,
      start_param: param || 'none'
    }
  };

  const payload = {
    data: [eventData],
    access_token: accessToken
  };

  // If testing with Meta Events Manager "Test events" tool
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
