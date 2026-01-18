import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = 'mongodb://localhost:27017/signal_db';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connection established'))
  .catch(err => console.error('MongoDB connection error:', err));

app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});