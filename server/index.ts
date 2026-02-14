import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { UserModel, MessageModel } from './db.js';
import { DoubleRatchet } from '../crypto/ratchet.js';

const app = express();

// Enable connections from multiple origins (e.g., Vite, CRA, etc.)
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5174',
    'http://localhost:5175',
  ],
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.use(express.json());

// Use environment variable if available (e.g., Docker), otherwise default to localhost
const MONGO_URI = process.env.MONGO_URL || 'mongodb://localhost:27017/signal_db';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connection established'))
  .catch(err => console.error('MongoDB connection error:', err));

app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

// Create HTTP server and "mount" Socket.IO on it
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5174',
    ],
    methods: ['GET', 'POST'],
  },
});

// userId -> socket.id mapping (simple, in memory)
const userSockets = new Map<string, string>();

// Ratchet state in memory: "userA|userB" -> DoubleRatchet
const ratchets = new Map<string, DoubleRatchet>();

function ratchetKey(a: string, b: string) {
  return [a, b].sort().join('|');
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Register session by userId
  socket.on('register-session', (userId: string) => {
    console.log(`User registered session: ${userId} -> ${socket.id}`);

    // Clear any previous registrations for this socket
    for (const [existingUserId, existingSocketId] of userSockets.entries()) {
      if (existingSocketId === socket.id && existingUserId !== userId) {
        userSockets.delete(existingUserId);
      }
    }

    userSockets.set(userId, socket.id);

    console.log('--- Active Sessions ---');
    for (const [uid, sid] of userSockets.entries()) {
      console.log(`  User ${uid}: ${sid}`);
    }
    console.log('-----------------------');

    // Deliver all pending (offline) messages
    (async () => {
      try {
        const pendingMessages = await MessageModel.find({ to: userId, delivered: false }).sort({ timestamp: 1 });
        if (pendingMessages.length > 0) {
          console.log(`Delivering ${pendingMessages.length} pending messages to ${userId}`);
          for (const msg of pendingMessages) {
            socket.emit('receive-message', {
              from: msg.from,
              ciphertext: msg.ciphertext,
              timestamp: msg.timestamp
            });
            msg.delivered = true;
            await msg.save();
          }
        }
      } catch (err) {
        console.error('Error delivering pending messages:', err);
      }
    })();
  });

  // Register public keys bundle from client
  socket.on('register-keys', async (data: any, cb?: (res: any) => void) => {
    try {
      const { userId, identityKeyPublic, signedPreKeyId, signedPreKeyPublic, signedPreKeySignature, oneTimePreKeys } = data;

      if (!userId || !identityKeyPublic || !signedPreKeyPublic) {
        cb && cb({ ok: false, error: 'Missing Required Keys' });
        return;
      }

      // Save/Update in DB (only public keys!)
      await UserModel.findOneAndUpdate(
        { userId },
        {
          userId,
          identityKeyPublic,
          signedPreKeyId,
          signedPreKeyPublic,
          signedPreKeySignature,
          oneTimePreKeys: oneTimePreKeys // Array of { keyId, publicKey }
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Registered Public Keys for user ${userId}`);
      cb && cb({ ok: true });
    } catch (err: any) {
      console.error('register-keys error', err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // Get PreKey Bundle for another user (to start X3DH in client)
  socket.on('get-prekey-bundle', async (data: { userId: string }, cb?: (res: any) => void) => {
    try {
      const user = await UserModel.findOne({ userId: data.userId });
      if (!user) {
        cb && cb({ ok: false, error: 'User not found' });
        return;
      }

      const availableOPK = user.oneTimePreKeys.find((key: any) => !key.used);

      if (availableOPK) {
        await UserModel.updateOne(
          { userId: data.userId, 'oneTimePreKeys.keyId': availableOPK.keyId },
          { $set: { 'oneTimePreKeys.$.used': true } }
        );
        console.log(`Consumed OPK ${availableOPK.keyId} for user ${data.userId} (Handed to sender)`);
      }

      const bundle = {
        userId: user.userId,
        identityKey: user.identityKeyPublic,
        signedPreKey: user.signedPreKeyPublic,
        signedPreKeySignature: user.signedPreKeySignature,
        oneTimePreKey: availableOPK ? availableOPK.publicKey : null,
        oneTimePreKeyId: availableOPK ? availableOPK.keyId : null
      };

      cb && cb({ ok: true, bundle });
    } catch (err: any) {
      console.error("get-prekey-bundle error", err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // Send message: Server only relays the Ciphertext
  socket.on('send-message', async (data: { to: string; from: string; ciphertext: string }) => {
    console.log('send-message (relay):', {
      to: data.to,
      from: data.from,
      size: data.ciphertext.length
    });

    const targetSocketId = userSockets.get(data.to);
    const isOnline = !!targetSocketId;

    // Save in DB (only ciphertext!)
    try {
      const chatId = ratchetKey(data.from, data.to);
      await MessageModel.create({
        from: data.from,
        to: data.to,
        ciphertext: data.ciphertext,
        chatId,
        timestamp: new Date(),
        delivered: isOnline
      });
      console.log(`Message saved to DB. ID: ${chatId}, Delivered: ${isOnline}`);
    } catch (err) {
      console.error('Error saving message to DB:', err);
    }

    // Send message to recipient immediately if online
    if (targetSocketId) {
      console.log(`Delivering immediately to ${data.to} (Socket: ${targetSocketId})`);
      io.to(targetSocketId).emit('receive-message', {
        from: data.from,
        ciphertext: data.ciphertext
      });
    } else {
      console.log(`Target user ${data.to} is offline. Message saved for later delivery.`);
      console.log('Current User Sockets:', Array.from(userSockets.entries()));
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [userId, sId] of userSockets.entries()) {
      if (sId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server (HTTP + Socket.IO) running on port ${PORT}`);
});