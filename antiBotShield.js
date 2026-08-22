/**
 * 🛡️ TeleTrack Anti-Bot & Click Fraud Shield
 * Multi-layer detection engine to block competitor click bots, scrapers, and automated flood attacks.
 * Protects Meta Pixel training data & ad spend by ensuring 100% human traffic.
 */

// In-Memory IP Rapid Click Tracker (Sliding 10-Second Window)
const ipClickHistory = new Map();
const MAX_CLICKS_PER_10S = 10;
const IP_WINDOW_MS = 10000;

// Known Bot & Scraper User-Agent Patterns
const BOT_SIGNATURES = [
  /headlesschrome/i,
  /puppeteer/i,
  /selenium/i,
  /playwright/i,
  /phantomjs/i,
  /python-requests/i,
  /aiohttp/i,
  /scrapy/i,
  /httpclient/i,
  /curl\//i,
  /wget\//i,
  /postmanruntime/i,
  /insomnia/i,
  /got\//i,
  /axios\//i,
  /node-fetch/i,
  /bytespider/i,
  /petalbot/i,
  /semrushbot/i,
  /ahrefsbot/i,
  /mj12bot/i,
  /dotbot/i,
  /zoominfobot/i,
  /screaming frog/i
];

// Clean memory every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipClickHistory.entries()) {
    const valid = timestamps.filter(t => now - t < IP_WINDOW_MS);
    if (valid.length === 0) {
      ipClickHistory.delete(ip);
    } else {
      ipClickHistory.set(ip, valid);
    }
  }
}, 300000);

/**
 * Evaluates an incoming HTTP request for bot / fraud indicators.
 * @param {Object} req - Express request object
 * @returns {Object} { isBot: boolean, reason: string, score: number }
 */
function evaluateRequest(req) {
  const userAgent = (req.headers['user-agent'] || '').trim();
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();

  // 1. Missing or blank User-Agent (Immediate Bot Flag)
  if (!userAgent || userAgent.length < 10) {
    return { isBot: true, reason: 'Blank or Invalid User-Agent', score: 99 };
  }

  // 2. Known Scraper / Automation Signatures
  for (const pattern of BOT_SIGNATURES) {
    if (pattern.test(userAgent)) {
      return { isBot: true, reason: `Automated Bot Signature: ${pattern.source}`, score: 95 };
    }
  }

  // 3. Rapid Click Flooding (Competitor Click Bot Defense)
  if (ip && ip !== '127.0.0.1' && ip !== '::1') {
    let history = ipClickHistory.get(ip) || [];
    history = history.filter(t => now - t < IP_WINDOW_MS);
    history.push(now);
    ipClickHistory.set(ip, history);

    if (history.length > MAX_CLICKS_PER_10S) {
      return { isBot: true, reason: `Rapid Click Flooding (${history.length} clicks/10s)`, score: 90 };
    }
  }

  // 4. Genuine Human Traffic Verification Passed
  return { isBot: false, reason: 'Verified Human Traffic', score: 0 };
}

module.exports = {
  evaluateRequest,
  BOT_SIGNATURES
};
