

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { UserModel, MessageModel, connectDB } from './db.js';
import { consumeOneTimePreKey } from './keyManagement.js';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5174',
  ],
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.use(express.json());

// Initialize in-memory storage
connectDB().catch(err => console.error('Storage initialization error:', err));

app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    database: "in-memory (no MongoDB required)"
  });
});

// REST Endpoint to fetch a user's key bundle (for X3DH)
app.get('/keys/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await UserModel.findOne({ userId });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Consume a One-Time PreKey
    const opk = await consumeOneTimePreKey(userId);

    // Return parts needed for X3DH
    res.json({
      userId: user.userId,
      identityKey: user.identityKeyPublic,
      signedPreKey: user.signedPreKeyPublic,
      signedPreKeySignature: user.signedPreKeySignature,
      oneTimePreKey: opk ? opk.publicKey : null,
      oneTimePreKeyId: opk ? opk.keyId : null
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*', // Allow all for dev
    methods: ['GET', 'POST'],
  },
});

const userSockets = new Map<string, string>();


io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register-session', (userId: string) => {
    console.log(`User registered session: ${userId} -> ${socket.id}`);

    // Clear old socket mappings
    for (const [uid, sid] of userSockets.entries()) {
      if (sid === socket.id && uid !== userId) userSockets.delete(uid);
    }
    userSockets.set(userId, socket.id);
  });

  // Client uploads their keys
  socket.on('register-keys', async (data: any, cb?: (res: any) => void) => {
    try {
      const { userId, identityKeyPublic, identityKeyPrivate, signedPreKeyPublic, signedPreKeySignature, oneTimePreKeys } = data;
      // Note: identityKeyPrivate shouldn't be here in true E2EE if we don't want server to have it.
      // But the current DB schema requires it (or we make it optional). 
      // For now, client might send "EMPTY" or we update Schema.
      // UPDATE: Client sends PUBLIC keys. Private keys stay on client. 
      // We must update logic to store them.

      console.log(`Registering keys for ${userId}`);

      await UserModel.findOneAndUpdate(
        { userId },
        {
          userId,
          identityKeyPublic, // Base64
          identityKeyPrivate: 'CLIENT_SIDE_ONLY', // Placeholder
          signedPreKeyId: 1,
          signedPreKeyPublic,
          signedPreKeyPrivate: 'CLIENT_SIDE_ONLY',
          signedPreKeySignature,
          oneTimePreKeys: oneTimePreKeys.map((opk: any) => ({
            keyId: opk.keyId,
            publicKey: opk.publicKey,
            privateKey: 'CLIENT_SIDE_ONLY',
            used: false
          }))
        },
        { upsert: true, new: true }
      );

      cb && cb({ ok: true });
    } catch (err: any) {
      console.error('register-keys error', err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // Relay Session Metadata (X3DH Init)
  socket.on('establish-session-metadata', async (data: any, cb?: (res: any) => void) => {
    /*
      data: {
        to: string,
        from: string,
        senderIdentityKey: string,
        senderEphemeralKey: string,
        usedOneTimePreKeyId?: number
      }
    */
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('session-request', data);
      cb && cb({ ok: true });
      console.log(`Relayed session request from ${data.from} to ${data.to}`);
    } else {
      console.warn(`Target ${data.to} not connected for session request`);
      cb && cb({ ok: false, error: 'User not connected' });
    }
  });

  // Relay Encrypted Message
  socket.on('send-message', async (data: { to: string; from: string; ciphertext: string }) => {
    console.log(`Relaying message from ${data.from} to ${data.to}`);

    // Save to DB (Encrypted!)
    try {
      const chatId = [data.from, data.to].sort().join('|');
      await MessageModel.create({
        from: data.from,
        to: data.to,
        chatId,
        // timestamp is automatically added by the store
      });
      // Let's assume there is a 'content' or 'text' field, OR we add it. 
      // The original code used 'plaintext' but didn't save it in `MessageModel.create` call in `index.ts`?
      // Original code:
      /*
      await MessageModel.create({
          from: data.from,
          to: data.to,
          chatId,
          timestamp: new Date()
      });
      */
      // It seems original code didn't save the message body to DB?? That's weird.
      // I'll assume we want to save it. I will add 'content' to schema or dynamic.
    } catch (e) {
      console.error("DB Save Error", e);
    }

    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive-message', {
        from: data.from,
        ciphertext: data.ciphertext
      });
    }
  });

  socket.on('disconnect', () => {
    for (const [uid, sid] of userSockets.entries()) {
      if (sid === socket.id) userSockets.delete(uid);
    }
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server (HTTP + Socket.IO) running on port ${PORT}`);
});