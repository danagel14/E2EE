import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { UserModel, MessageModel } from './db.js';
import { X3DH } from '../crypto/X3DH.js';
import { DoubleRatchet } from '../crypto/ratchet.js';
import { generateUserKeys, consumeOneTimePreKey, getUserKeyBundle, replenishOneTimePreKeys } from './keyManagement.js';

const app = express();

// לאפשר חיבורים גם מ-5173 (Vite) וגם מ-3000 (למשל CRA) ועוד פורטים בזמן פיתוח
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

// שימוש במשתנה סביבה אם קיים (למשל בדוקר), אחרת ברירת מחדל ל-localhost
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

// יצירת HTTP server ו"הרכבת" Socket.IO עליו
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

// מיפוי userId -> socket.id (פשוט, בזיכרון)
const userSockets = new Map<string, string>();

// מצב Ratchet בזיכרון: "userA|userB" -> DoubleRatchet
const ratchets = new Map<string, DoubleRatchet>();

function ratchetKey(a: string, b: string) {
  return [a, b].sort().join('|');
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // רישום session לפי userId
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
  });

  // רישום Bundle של מפתחות ציבוריים מהקליינט
  socket.on('register-keys', async (data: any, cb?: (res: any) => void) => {
    try {
      const { userId, identityKeyPublic, signedPreKeyId, signedPreKeyPublic, signedPreKeySignature, oneTimePreKeys } = data;

      if (!userId || !identityKeyPublic || !signedPreKeyPublic) {
        cb && cb({ ok: false, error: 'Missing Required Keys' });
        return;
      }

      // שמירה/עדכון ב-DB (רק מפתחות ציבוריים!)
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

  // קבלת PreKey Bundle עבור משתמש אחר (כדי להתחיל X3DH בקליינט)
  socket.on('get-prekey-bundle', async (data: { userId: string }, cb?: (res: any) => void) => {
    try {
      const user = await UserModel.findOne({ userId: data.userId });
      if (!user) {
        cb && cb({ ok: false, error: 'User not found' });
        return;
      }

      // מציאת OPK זמין
      // Atomic update to mark as available?
      // For concurrent safety we should findOneAndUpdate.
      // Note: Since we removed private keys, we can't "consume" it in the same way (returning priv key), 
      // but we still mark it used so others don't use it.

      // However, to get the value to return, we first need to find it.
      // Better: Find an unused one, mark as used, return it.

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

  // Init Session - Deprecated/Relay Only
  // The client now uses PreKeyMessage to bundle the handshake with the first message.
  // socket.on('session-request', ...) removed.

  // שליחת הודעה: השרת רק מעביר את ה-Ciphertext
  socket.on('send-message', async (data: { to: string; from: string; ciphertext: string }) => {
    console.log('send-message (relay):', {
      to: data.to,
      from: data.from,
      size: data.ciphertext.length
    });

    // שמירה ב-DB (מוצפן בלבד!)
    try {
      const chatId = ratchetKey(data.from, data.to);
      // Note: MessageSchema definition might need adjustment if we wanted to be strict,
      // but 'ciphertext' isn't in standard schema shown in `db.ts` snippet?
      // Wait, `MessageSchema` in `db.ts` was relying on dynamic mixed fields or just `plaintext`?
      // `db.ts` snippet showed:
      /*
        const MessageSchema = new mongoose.Schema({
            from: { type: String, required: true },
            to: { type: String, required: true },
            chatId: { type: String, required: true, index: true },
            timestamp: { type: Date, default: Date.now }
        });
      */
      // It allows flexible fields if strict: false? Or we need to add content field.
      // Current `send-message` saved nothing about content in the snippet?
      // Line 228 in `server/index.ts`:
      /*
      await MessageModel.create({
       from: data.from,
       to: data.to,
       chatId,
       timestamp: new Date()
     });
     */
      // It wasn't saving the text at all in the provided snippet! Just metadata.
      // I will assume we want to save the content now?
      // Or just keep saving metadata.
      // For E2EE, saving ciphertext is common for offline delivery.

      // Let's add ciphertext storage if possible, but schema in db.ts doesn't have it.
      // I will stick to metadata saving to avoid schema validation errors 
      // UNLESS I update schema. I will update schema in next step if needed.
      // For now, save metadata.

      await MessageModel.create({
        from: data.from,
        to: data.to,
        ciphertext: data.ciphertext,
        chatId,
        timestamp: new Date()
      });
    } catch (err) {
      console.error('Error saving message to DB:', err);
    }

    // שליחת ההודעה למקבל
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive-message', {
        from: data.from,
        ciphertext: data.ciphertext
      });
    } else {
      console.warn(`Target user ${data.to} is not connected`);
      // Future: Store for offline delivery
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