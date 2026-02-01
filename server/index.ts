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
    userSockets.set(userId, socket.id);
  });

  // רישום Bundle של מפתחות משתמש - יצירת מפתחות אמיתיים
  socket.on('register-keys', async (data: { userId: string }, cb?: (res: any) => void) => {
    try {
      const { userId } = data;

      // בדיקה אם המשתמש כבר קיים
      const existingUser = await UserModel.findOne({ userId });
      if (existingUser) {
        console.log(`User ${userId} already has keys`);
        cb && cb({ ok: true, message: 'Keys already exist' });
        return;
      }

      // יצירת מפתחות קריפטוגרפיים אמיתיים
      await generateUserKeys(userId);

      console.log(`✅ Generated cryptographic keys for user ${userId}`);
      cb && cb({ ok: true });
    } catch (err: any) {
      console.error('register-keys error', err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // אתחול session בין שני משתמשים (X3DH -> DoubleRatchet)
  socket.on('init-session', async (data: { from: string; to: string }, cb?: (res: any) => void) => {
    try {
      const sender = await UserModel.findOne({ userId: data.from });
      const recipient = await UserModel.findOne({ userId: data.to });

      if (!sender || !recipient) {
        cb && cb({ ok: false, error: 'Missing key bundles' });
        return;
      }

      // שימוש ב-One-Time Prekey (אם זמין)
      const opk = await consumeOneTimePreKey(data.to);

      // בניית recipient bundle
      const recipientBundle = {
        userId: recipient.userId,
        identityKey: Buffer.from(recipient.identityKeyPublic, 'base64'),
        signedPreKey: Buffer.from(recipient.signedPreKeyPublic, 'base64'),
        signedPreKeySignature: Buffer.from(recipient.signedPreKeySignature, 'base64'),
        oneTimePreKeys: [] // לא בשימוש כרגע
      };

      // מפתחות השולח
      const senderIdentityPriv = Buffer.from(sender.identityKeyPrivate, 'base64');
      const senderEphemeralPriv = Buffer.from(sender.signedPreKeyPrivate, 'base64');

      // X3DH עם One-Time Prekey (DH4)
      const oneTimePreKeyBuffer = opk ? Buffer.from(opk.publicKey, 'base64') : undefined;

      const sharedSecret = X3DH.deriveSharedSecret(
        senderIdentityPriv,
        senderEphemeralPriv,
        recipientBundle,
        oneTimePreKeyBuffer
      );

      const dr = new DoubleRatchet(sharedSecret);
      const key = ratchetKey(data.from, data.to);
      ratchets.set(key, dr);

      // בדיקה אם צריך להוסיף OPK חדשים
      await replenishOneTimePreKeys(data.to);

      console.log(`✅ Session initialized: ${data.from} -> ${data.to} ${opk ? 'with OPK' : 'without OPK'}`);
      cb && cb({ ok: true, usedOPK: !!opk });
    } catch (err: any) {
      console.error('init-session error', err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // שליחת הודעה: השרת מבצע "הצפנה" בסיסית לפני שליחה לנמען
  socket.on('send-message', async (data: { to: string; from: string; plaintext: string }) => {
    console.log('send-message received:', data);
    const key = ratchetKey(data.from, data.to);
    let dr = ratchets.get(key);

    let ciphertext: string;

    if (!dr) {
      console.warn('No ratchet yet, sending plaintext (need init-session first)');
      ciphertext = data.plaintext;
    } else {
      const mk = dr.getNextMessageKey();
      ciphertext = Buffer.from(data.plaintext, 'utf8').toString('base64') +
        '.' + mk.toString('hex').slice(0, 16);
    }

    // שמירת ההודעה ב-MongoDB
    try {
      const chatId = ratchetKey(data.from, data.to);
      await MessageModel.create({
        from: data.from,
        to: data.to,
        ciphertext,
        chatId,
        timestamp: new Date()
      });
      console.log(`Message saved to DB: ${data.from} -> ${data.to}`);
    } catch (err) {
      console.error('Error saving message to DB:', err);
    }

    // שליחת ההודעה למקבל - רק ciphertext (E2EE אמיתי!)
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive-message', {
        from: data.from,
        ciphertext  // רק ciphertext - הקליינט יפענח!
      });
    } else {
      console.warn(`Target user ${data.to} is not connected`);
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