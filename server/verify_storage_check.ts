import { io } from "socket.io-client";
import mongoose from "mongoose";
import { MessageModel } from "./db.js"; // Ensure .js extension is correct for ES modules in tsx context or just use .ts if running with tsx

// Configuration
const SERVER_URL = "http://127.0.0.1:3001";
const MONGO_URI = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/signal_db";

async function verify() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false
    });

    const senderId = "test_sender_" + Date.now();
    const receiverId = "test_receiver_" + Date.now();
    const testMessage = "Hello World " + Date.now();

    return new Promise((resolve, reject) => {
        socket.on("connect", async () => {
            console.log("Connected to server via Socket.IO");

            // Register sender
            socket.emit("register-session", senderId);

            const payload = {
                from: senderId,
                to: receiverId,
                plaintext: testMessage
            };

            console.log("Sending message:", payload);
            socket.emit("send-message", payload);

            setTimeout(async () => {
                try {
                    console.log("Checking database...");
                    const msg = await MessageModel.findOne({ from: senderId, to: receiverId }).sort({ timestamp: -1 });

                    if (!msg) {
                        reject(new Error("Message not found in DB"));
                        return;
                    }

                    console.log("Found message:", msg.toObject());

                    if (msg.get('ciphertext') === undefined) {
                        console.log("SUCCESS: ciphertext is undefined as expected.");
                        resolve(true);
                    } else {
                        console.error("FAILURE: ciphertext is present:", msg.get('ciphertext'));
                        reject(new Error("Ciphertext should not be saved"));
                    }
                } catch (err) {
                    reject(err);
                } finally {
                    socket.disconnect();
                    await mongoose.disconnect();
                }
            }, 2000);
        });

        socket.on("connect_error", (err) => {
            console.error("Connection error:", err);
            reject(err);
        });
    });
}

verify().then(() => {
    console.log("Verification Passed");
    process.exit(0);
}).catch((err) => {
    console.error("Verification Failed", err);
    process.exit(1);
});
