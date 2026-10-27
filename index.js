// Relay Server - Device code pairing + command relay over WebSocket
// Deploy to Render.com / Railway.app free tier
// No WebRTC: all commands travel over Socket.IO for reliability.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Render free tier heartbeats:
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 30000
});

app.use(express.json());

// Devices: code -> { id, type, socketId, hostname, online, stableId?, userLabel?, customName? }
const devices = new Map();

// stableId -> code mapping, so we can track devices across reconnects
const stableIdMap = new Map();

// Custom names: stableId -> customName (persisted by dashboard)
const deviceNames = new Map();

function generateDeviceCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = (prefix || 'RCS') + '-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', devices: devices.size });
});

app.get('/api/device/:code', (req, res) => {
  const device = devices.get(req.params.code.toUpperCase());
  if (!device) {
    return res.status(404).json({ error: 'Device not found or offline' });
  }
  const displayName = device.customName || device.userLabel || device.hostname;
  res.json({
    code: device.code,
    online: device.online,
    hostname: device.hostname,
    type: device.type,
    stableId: device.stableId,
    userLabel: device.userLabel,
    customName: device.customName,
    displayName
  });
});

// Set a custom display name for a device (by stableId)
app.post('/api/device-name', (req, res) => {
  const { stableId, name } = req.body;
  if (!stableId || !name) {
    return res.status(400).json({ error: 'stableId and name are required' });
  }
  deviceNames.set(stableId, name);

  // Update the device entry if online
  for (const [code, d] of devices.entries()) {
    if (d.stableId === stableId && d.type === 'client') {
      d.customName = name;
    }
  }

  console.log(`[RELAY] Device name set: stableId=${stableId} → ${name}`);
  res.json({ status: 'ok', stableId, name });
});

// Get device name by stableId
app.get('/api/device-name/:stableId', (req, res) => {
  const name = deviceNames.get(req.params.stableId);
  if (!name) {
    return res.status(404).json({ error: 'No custom name set for this device' });
  }
  res.json({ stableId: req.params.stableId, name });
});

app.get('/api/online-clients', (req, res) => {
  const clients = [];
  for (const [code, d] of devices.entries()) {
    if (d.online && d.type === 'client') {
      const displayName = d.customName || d.userLabel || d.hostname;
      clients.push({
        code: d.code,
        hostname: d.hostname,
        type: d.type,
        stableId: d.stableId,
        userLabel: d.userLabel,
        customName: d.customName,
        displayName
      });
    }
  }
  res.json({ clients });
});

io.on('connection', (socket) => {
  let device = null;

  socket.on('register', ({ type, hostname, stableId, userLabel }) => {
    const code = generateDeviceCode(type === 'controller' ? 'GL' : undefined);
    device = {
      code,
      id: socket.id,
      type, // 'client' or 'controller'
      socketId: socket.id,
      hostname: hostname || 'unknown',
      online: true,
      stableId: stableId || null,
      userLabel: userLabel || null,
      customName: null
    };

    // For clients, check if this stableId was seen before (reconnect)
    let displayName = null;
    if (stableId && type === 'client') {
      // Map stableId to this new code
      stableIdMap.set(stableId, code);
      // Restore custom name if set
      const savedName = deviceNames.get(stableId);
      if (savedName) {
        device.customName = savedName;
        displayName = savedName;
      }
    }

    devices.set(code, device);
    const logParts = [`[RELAY] ${code} registered as ${type} (${hostname})`];
    if (stableId) logParts.push(`stableId=${stableId}`);
    if (userLabel) logParts.push(`userLabel=${userLabel}`);
    if (displayName) logParts.push(`customName=${displayName}`);
    console.log(logParts.join(' '));

    socket.emit('registered', {
      code,
      hostname,
      stableId,
      userLabel,
      customName: displayName || null,
      displayName: displayName || userLabel || hostname
    });
  });

  // Controller looks up a client device by code
  socket.on('lookup', ({ code }) => {
    const target = devices.get(code.toUpperCase());
    if (!target || !target.online) {
      socket.emit('lookup-result', { code, found: !target, error: target ? 'Device offline' : 'Device not found' });
    } else {
      const displayName = target.customName || target.userLabel || target.hostname;
      socket.emit('lookup-result', {
        code,
        found: true,
        hostname: target.hostname,
        targetCode: target.code,
        stableId: target.stableId,
        userLabel: target.userLabel,
        customName: target.customName,
        displayName
      });
    }
  });

  // Controller connects to target: relay just acknowledges and sets a mapping
  socket.on('connect-to-target', ({ targetCode }) => {
    const target = devices.get(targetCode.toUpperCase());
    if (!target || !target.online) {
      socket.emit('connect-result', { targetCode, ok: false, error: target ? 'Offline' : 'Not found' });
    } else {
      console.log(`[RELAY] Controller ${socket.id} connected to target ${targetCode}`);
      socket.emit('connect-result', { targetCode, ok: true, hostname: target.hostname });
      // Notify target that controller is ready
      socket.to(target.socketId).emit('controller-connected', { controllerCode: device?.code || 'unknown' });
    }
  });

  // Controller sends a command to target client via code
  socket.on('command', ({ targetCode, action, payload }) => {
    const target = devices.get(targetCode.toUpperCase());
    if (!target || !target.online) {
      socket.emit('command-status', { action, status: 'error', message: 'Target offline or not found' });
      return;
    }
    console.log(`[RELAY] Command ${action} to ${targetCode}`);
    socket.to(target.socketId).emit('command', { action, payload });
  });

  // Client replies with result of command
  socket.on('command-result', ({ action, success, message, data, output }) => {
    // Forward results back to all connected controllers (safe: only your dashboard connects as controller)
    if (device && device.type === 'client') {
      const displayName = device.customName || device.userLabel || device.hostname;
      io.emit('command-result-from-client', {
        fromCode: device.code,
        fromHostname: device.hostname,
        fromStableId: device.stableId,
        action,
        success,
        message,
        data,
        output,
        displayName
      });
    }
  });

  socket.on('disconnect', () => {
    for (const [code, d] of devices.entries()) {
      if (d.socketId === socket.id) {
        d.online = false;
        console.log(`[RELAY] ${code} disconnected`);
        setTimeout(() => {
          if (!d.online) {
            console.log(`[RELAY] Cleaning up stale device: ${code}`);
            devices.delete(code);
          }
        }, 60000);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n  Remote Control Relay Server`);
  console.log(`  Port: ${PORT}\n`);
});
