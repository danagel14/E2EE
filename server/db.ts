import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },

  // Identity Key (IK) - long-term key pair
  identityKeyPublic: { type: String, required: true },
  identityKeyPrivate: { type: String, required: true },

  // Signed Pre Key (SPK) - medium-term key pair
  signedPreKeyId: { type: Number, required: true },
  signedPreKeyPublic: { type: String, required: true },
  signedPreKeyPrivate: { type: String, required: true },
  signedPreKeySignature: { type: String, required: true },

  // One-Time Pre Keys (OPK) - single-use key pairs
  oneTimePreKeys: [{
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
    used: { type: Boolean, default: false }
  }]
});

export const UserModel = mongoose.model('User', UserSchema);

// סכמה להודעות
const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  ciphertext: { type: String, required: true },
  chatId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now }
});

export const MessageModel = mongoose.model('Message', MessageSchema);

export const connectDB = async () => {
  const uri = process.env.MONGO_URL || 'mongodb://localhost:27017/signal_db';
  await mongoose.connect(uri);
  console.log("MongoDB Connected:", uri);
};