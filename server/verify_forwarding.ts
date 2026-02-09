import { io } from "socket.io-client";
import { DoubleRatchet } from "../crypto/ratchet.js"; // We might need this if we want to simulate full flow, but for now we just check event delivery

const SERVER_URL = "http://127.0.0.1:3001";

async function verifyForwarding() {
    const aliceId = "alice_" + Date.now();
    const bobId = "bob_" + Date.now();

    console.log(`Testing forwarding from ${aliceId} to ${bobId}`);

    const socketAlice = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
    const socketBob = io(SERVER_URL, { transports: ['websocket'], reconnection: false });

    const pAlice = new Promise<void>((resolve) => socketAlice.on('connect', resolve));
    const pBob = new Promise<void>((resolve) => socketBob.on('connect', resolve));

    await Promise.all([pAlice, pBob]);
    console.log("Both clients connected");

    // Register sessions
    socketAlice.emit('register-session', aliceId);
    socketBob.emit('register-session', bobId);

    // Wait a bit for registration processing
    await new Promise(r => setTimeout(r, 500));

    // Bob listens for message
    const messageReceivedPromise = new Promise((resolve, reject) => {
        socketBob.on('receive-message', (data) => {
            console.log("Bob received message:", data);
            if (data.from === aliceId) {
                resolve(data);
            } else {
                reject(new Error(`Received message from wrong sender: ${data.from}`));
            }
        });

        // Timeout
        setTimeout(() => reject(new Error("Timeout waiting for message")), 5000);
    });

    // Alice sends message
    // Note: we need to handle the ratchet stuff if the server logic depends on it?
    // Server logic:
    // if (!dr) { warn... ciphertext = plaintext }
    // So we don't strictly need init-session to test "receive-message" emission, 
    // UNLESS the server errors out before emitting.
    // The server code:
    // 1. Logs
    // 2. Checks ratchets. If missing -> warning, ciphertext=plaintext.
    // 3. Saves to DB (async)
    // 4. Emits to target

    // So sending without init-session SHOULD work for verification of routing.

    console.log("Alice sending message...");
    socketAlice.emit('send-message', {
        from: aliceId,
        to: bobId,
        plaintext: "Hello Bob"
    });

    try {
        await messageReceivedPromise;
        console.log("SUCCESS: Message forwarded correctly.");
    } catch (err) {
        console.error("FAILURE: Message not received.", err);
        process.exit(1);
    } finally {
        socketAlice.disconnect();
        socketBob.disconnect();
    }
}

verifyForwarding().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
