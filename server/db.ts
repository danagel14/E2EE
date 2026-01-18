import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  identityKey: { type: String, required: true },
  signedPreKey: { type: String, required: true },
  signature: { type: String, required: true },
  oneTimePreKeys: [{ keyId: Number, publicKey: String }] 
});

export const UserModel = mongoose.model('User', UserSchema);

export const connectDB = async () => {
  await mongoose.connect('mongodb://localhost:2017/signal_db');
  console.log("MongoDB Connected");
};