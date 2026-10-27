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

// Devices: code -> { id, type, socketId, hostname, online }
const devices = new Map();

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
  res.json({ code: device.code, online: device.online, hostname: device.hostname, type: device.type });
});

app.get('/api/online-clients', (req, res) => {
  const clients = [];
  for (const [code, d] of devices.entries()) {
    if (d.online && d.type === 'client') {
      clients.push({ code: d.code, hostname: d.hostname, type: d.type });
    }
  }
  res.json({ clients });
});

io.on('connection', (socket) => {
  let device = null;

  socket.on('register', ({ type, hostname }) => {
    const code = generateDeviceCode(type === 'controller' ? 'GL' : undefined);
    device = {
      code,
      id: socket.id,
      type, // 'client' or 'controller'
      socketId: socket.id,
      hostname: hostname || 'unknown',
      online: true
    };
    devices.set(code, device);
    console.log(`[RELAY] ${code} registered as ${type} (${hostname})`);
    socket.emit('registered', { code, hostname });
  });

  // Controller looks up a client device by code
  socket.on('lookup', ({ code }) => {
    const target = devices.get(code.toUpperCase());
    if (!target || !target.online) {
      socket.emit('lookup-result', { code, found: !target, error: target ? 'Device offline' : 'Device not found' });
    } else {
      socket.emit('lookup-result', { code, found: true, hostname: target.hostname, targetCode: target.code });
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
      io.emit('command-result-from-client', {
        fromCode: device.code,
        fromHostname: device.hostname,
        action,
        success,
        message,
        data,
        output
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
