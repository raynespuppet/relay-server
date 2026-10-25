# Remote Control Relay Server

**A lightweight signaling relay for WebRTC peer-to-peer connections.**

This server handles device code generation/validation and WebRTC signaling messages. It does NOT relay screen/audio/data streams — those flow directly peer-to-peer once the WebRTC connection is established.

- Express HTTP server for device codes
- Socket.IO WebSocket server for WebRTC signaling
- Runs on PORT 10000 (configurable)
- Stateless — no database needed

## Deploy on Render.com (Recommended, Free Tier)

1. **Create a Render account** at [render.com](https://render.com) if you don't have one.

2. **Push this relay-server to a GitHub repo** (or upload as a zip). The repo can be private.

3. On Render, click **New → Web Service**.

4. Choose your repo or upload the zip file.

5. Configure:
   - **Name:** `remote-control-relay`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Plan:** Free

6. Click **Create Web Service**. Render will build and deploy automatically.

7. Once deployed, copy your service URL — it will look like:
   ```
   https://remote-control-relay-xxxx.onrender.com
   ```

8. **Important:** Paste that URL into:
   - `client/config.json` → `"relayServer": "https://remote-control-relay-xxxx.onrender.com"`
   - `dashboard/config.json` → `"relayServer": "https://remote-control-relay-xxxx.onrender.com"`

That's it. You're live. 🚀

## Alternative: Deploy on Railway.app

1. Sign up at [railway.app](https://railway.app)

2. **New Project → Deploy from GitHub repo** (or deploy from ZIP)

3. Railway auto-detects Node.js. Just verify:
   - **Start Command:** `node index.js`

4. Add environment variable:
   - `PORT` = `10000` (optional, Railway auto-assigns)

5. Click **Deploy**. Once live, click the service name → copy the production URL.

6. Same as Render — paste that URL into `client/config.json` and `dashboard/config.json`.

## After Deployment

1. Verify it's running by opening the URL in a browser. You should see:
   ```json
   {"status":"ok","service":"relay"}
   ```

2. Update both client and dashboard `config.json` files with your deployed URL.

3. Run `npm run build` in both `client/` and `dashboard/` to rebuild with the new config.

4. Test: generate a device code on the dashboard, connect from the client — WebRTC signaling will route through your relay.

## Local Testing (Before Deploying)

```bash
npm install
node index.js
```

Then set `"relayServer": "http://localhost:10000"` in client and dashboard config for local testing.
