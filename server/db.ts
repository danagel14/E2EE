import mongoose from 'mongoose';

// --- User Schema (remains the same) ---
const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },

  // Identity Key (IK) - Public Only
  identityKeyPublic: { type: String, required: true },

  // Signed Pre Key (SPK) - Public Only
  signedPreKeyId: { type: Number, required: true },
  signedPreKeyPublic: { type: String, required: true },
  signedPreKeySignature: { type: String, required: true },

  // One-Time Pre Keys (OPK) - Public Only
  oneTimePreKeys: [{
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    used: { type: Boolean, default: false }
  }]
});

export const UserModel = mongoose.model('User', UserSchema);

// --- Message Interface
export interface IMessage {
  from: string;
  to: string;
  ciphertext: string;
  chatId: string;
  timestamp: Date;
}

// --- Message Schema
const MessageSchema = new mongoose.Schema<IMessage>({
  from: { type: String, required: true },
  to: { type: String, required: true },
  ciphertext: { type: String, required: true },
  chatId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now }
});

export const MessageModel = mongoose.model<IMessage>('Message', MessageSchema);

export const connectDB = async () => {
  const uri = process.env.MONGO_URL || 'mongodb://localhost:27017/signal_db';
  try {
    await mongoose.connect(uri);
    console.log("MongoDB Connected:", uri);
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
};