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
      console.log('\n========================================');
      console.log('     X3DH HANDSHAKE INITIATED');
      console.log('========================================');
      console.log(`Sender: User ${data.from}`);
      console.log(`Recipient: User ${data.to}`);

      const sender = await UserModel.findOne({ userId: data.from });
      const recipient = await UserModel.findOne({ userId: data.to });

      if (!sender || !recipient) {
        cb && cb({ ok: false, error: 'Missing key bundles' });
        return;
      }

      console.log(`\nKey Bundles Retrieved:`);
      console.log(`  Sender Identity Key: ${sender.identityKeyPublic.slice(0, 30)}...`);
      console.log(`  Recipient Identity Key: ${recipient.identityKeyPublic.slice(0, 30)}...`);

      // שימוש ב-One-Time Prekey (אם זמין)
      const opk = await consumeOneTimePreKey(data.to);
      console.log(`\nOne-Time PreKey Status: ${opk ? 'CONSUMED' : 'NOT AVAILABLE'}`);
      if (opk) {
        console.log(`  OPK ID: ${opk.keyId}`);
      }

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

      console.log(`\nPerforming X3DH Diffie-Hellman Operations:`);
      console.log(`  DH1: IKa (sender identity) || SPKb (recipient signed prekey)`);
      console.log(`  DH2: EKa (sender ephemeral) || IKb (recipient identity)`);
      console.log(`  DH3: EKa (sender ephemeral) || SPKb (recipient signed prekey)`);
      if (oneTimePreKeyBuffer) {
        console.log(`  DH4: EKa (sender ephemeral) || OPKb (one-time prekey) [INCLUDED]`);
      } else {
        console.log(`  DH4: SKIPPED (no OPK available)`);
      }

      const sharedSecret = X3DH.deriveSharedSecret(
        senderIdentityPriv,
        senderEphemeralPriv,
        recipientBundle,
        oneTimePreKeyBuffer
      );

      console.log(`\nShared Secret Generated (SHA-256):`);
      console.log(`  ${sharedSecret.toString('hex').slice(0, 64)}...`);

      const dr = new DoubleRatchet(sharedSecret);
      const key = ratchetKey(data.from, data.to);
      ratchets.set(key, dr);

      console.log(`\nDouble Ratchet Initialized for session: ${key}`);

      // בדיקה אם צריך להוסיף OPK חדשים
      await replenishOneTimePreKeys(data.to);

      console.log(`\n========================================`);
      console.log(`  SESSION ESTABLISHED SUCCESSFULLY`);
      console.log(`========================================`);
      console.log(`Session: ${data.from} <-> ${data.to}`);
      console.log(`Security Level: ${opk ? '4-DH (with OPK)' : '3-DH (without OPK)'}\n`);

      cb && cb({ ok: true, usedOPK: !!opk });
    } catch (err: any) {
      console.error('ERROR: init-session failed', err);
      cb && cb({ ok: false, error: err.message });
    }
  });

  // שליחת הודעה: השרת מבצע "הצפנה" בסיסית לפני שליחה לנמען
  socket.on('send-message', async (data: { to: string; from: string; plaintext: string }) => {
    // Add RTL marker for proper Hebrew display
    const displayText = data.plaintext.match(/[\u0590-\u05FF]/)
      ? `\u202B${data.plaintext}\u202C`
      : data.plaintext;

    console.log('send-message received:', {
      to: data.to,
      from: data.from,
      plaintext: displayText
    });
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