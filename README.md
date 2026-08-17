# ⚡ TeleTrack CAPI — Multi-Channel Telegram Lead Tracking & Meta CAPI Panel

A complete **Multi-Channel & Multi-Pixel Lead Tracking System** that tracks leads from **Meta Ads (Facebook & Instagram)** to your **Telegram Channels/Support**, logs them into **Meta Conversions API (CAPI)** in real-time, and provides a **Live Web Tracking Dashboard**.

---

## 🌟 Key Features

1. **Multi-Channel & Multi-Pixel Routing (1 Master Bot handles 10+ Channels):**
   - No need to create 10 different bots.
   - Using dynamic start parameters (`?start=cric1`, `?start=cric2`), the bot routes the user to the correct channel and fires the matching Meta Pixel.
2. **100% Genuine User Verification:**
   - Captures real Telegram User ID, Name, and @username.
   - Sends verified `Lead` events via Meta Graph API (Conversions API) with SHA-256 hashed user data and Click IDs (`fbc`).
3. **Live Web Tracking Dashboard (`http://localhost:3000`):**
   - Real-time KPIs: Today's Leads, Week's Leads, All-time Leads, Meta Sync Rate.
   - **Live Leads Feed Table:** Full details of every user with direct chat action buttons.
   - **Channels Manager:** Add, edit, or delete channels, custom welcome messages, and custom pixels without touching code.
   - **Meta Ad Link Generator:** 1-Click copy of ready-to-use Meta Ad destination URLs.
   - **CSV Export:** Download all leads with 1 click.
   - **Send Test Lead:** Simulate and test Meta CAPI events right from the UI.

---

## 🚀 Quick Setup

### 1. Configure `.env`
Open [`.env`](file://.env) and add your master credentials:

```env
# Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Default Personal/Support Telegram Username (without @)
PERSONAL_TELEGRAM_USERNAME=your_username

# Master Meta Pixel / Dataset ID
META_PIXEL_ID=your_pixel_id

# Master Meta Conversions API Access Token
META_ACCESS_TOKEN=your_access_token

# Optional: Meta Test Event Code (e.g., TEST12345)
META_TEST_EVENT_CODE=

# Port for Web Dashboard (Default: 3000)
PORT=3000
```

---

### 2. Start the System
```bash
npm start
```
* **Web Tracking Panel:** Open `http://localhost:3000` in your browser.
* **Telegram Bot:** Automatically connects and listens for incoming ad clicks.

---

## 🎯 Meta Ads Setup (Destination URL)

In **Meta Ads Manager**, set the Destination / Website URL for each ad:

| Channel | Meta Ad Destination URL | Resulting User Action |
| :--- | :--- | :--- |
| **Cricket Channel 1** | `https://t.me/YOUR_BOT_USERNAME?start=cric1_{{ad.id}}` | Joins Channel 1 + Fires Pixel 1 |
| **Cricket Channel 2** | `https://t.me/YOUR_BOT_USERNAME?start=cric2_{{ad.id}}` | Joins Channel 2 + Fires Pixel 2 |
| **Cricket Channel 3** | `https://t.me/YOUR_BOT_USERNAME?start=cric3_{{ad.id}}` | Joins Channel 3 + Fires Pixel 3 |

*(Replace `YOUR_BOT_USERNAME` with your bot's username created on BotFather).*

---

## 🚢 24/7 Deployment (VPS / Cloud)

To keep both the Bot and Dashboard running 24/7 on your server:

```bash
npm install -g pm2
pm2 start server.js --name "teletrack-capi"
pm2 save
pm2 startup
```
