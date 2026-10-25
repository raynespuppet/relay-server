// Relay Server - Device code pairing + WebRTC signaling relay
// Deploy to Render.com / Railway.app free tier
// Client and dashboard connect here automatically (hardcoded URL)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());

// Registered devices: code -> { id, type, socketId, hostname, online }
const devices = new Map();

// Signaling rooms: roomId -> { senderSocketId, receiverSocketId }
const signalingRooms = new Map();

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

// Look up a device by code (for controller to find target)
app.get('/api/device/:code', (req, res) => {
  const device = devices.get(req.params.code.toUpperCase());
  if (!device) {
    return res.status(404).json({ error: 'Device not found or offline' });
  }
  res.json({ code: device.code, online: device.online, hostname: device.hostname, type: device.type });
});

// List all online client devices (for dashboard to auto-discover)
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

  // Client or controller registers with this relay
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
    if (!target) {
      socket.emit('lookup-result', { code, found: false, error: 'Device not found or offline' });
    } else if (!target.online) {
      socket.emit('lookup-result', { code, found: false, error: 'Device offline' });
    } else {
      socket.emit('lookup-result', { code, found: true, hostname: target.hostname, targetSocketId: target.socketId });
    }
  });

  // Start WebRTC signaling between two devices
  socket.on('start-signaling', ({ roomId, targetSocketId }) => {
    signalingRooms.set(roomId, {
      senderSocketId: socket.id,
      receiverSocketId: targetSocketId
    });
    console.log(`[RELAY] Signaling room ${roomId}: ${socket.id} -> ${targetSocketId}`);

    // Notify both peers
    io.to(socket.id).emit('signaling-started', { roomId, yourRole: 'sender' });
    io.to(targetSocketId).emit('signaling-started', { roomId, yourRole: 'receiver' });
  });

  // Forward WebRTC messages (offer, answer, ICE)
  socket.on('signal', ({ roomId, message, toSocketId }) => {
    if (!toSocketId) {
      const room = signalingRooms.get(roomId);
      if (room) {
        const target = room.senderSocketId === socket.id ? room.receiverSocketId : room.senderSocketId;
        io.to(target).emit('signal', { roomId, message, fromSocketId: socket.id });
      }
    } else {
      io.to(toSocketId).emit('signal', { roomId, message, fromSocketId: socket.id });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    // Remove device
    for (const [code, d] of devices.entries()) {
      if (d.socketId === socket.id) {
        d.online = false;
        console.log(`[RELAY] ${code} disconnected`);
        // Auto-remove after 60s
        setTimeout(() => {
          if (!d.online) devices.delete(code);
        }, 60000);
        break;
      }
    }

    // Clean signaling rooms
    for (const [roomId, room] of signalingRooms.entries()) {
      if (room.senderSocketId === socket.id || room.receiverSocketId === socket.id) {
        signalingRooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n  Remote Control Relay Server`);
  console.log(`  Port: ${PORT}\n`);
});
