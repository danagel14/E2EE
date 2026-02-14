# End-to-End Encrypted (E2EE) Chat Application

This project is a secure messaging application that implements the **Signal Protocol** for End-to-End Encryption (E2EE). It ensures that messages are encrypted on the sender's device and can only be decrypted by the intended recipient, making them unreadable to the server or any third party.

The application consists of a **React** frontend and a **Node.js/Express** backend with **MongoDB** for storage, synchronized via **Socket.IO** for real-time communication.

## Features

*   **End-to-End Encryption:** Messages are encrypted using the Double Ratchet Algorithm, X3DH, and AES-256.
*   **Real-Time Messaging:** Instant message delivery using Socket.IO.
*   **Secure Identity:** User identity verification using cryptographic keys.
*   **Forward Secrecy:** Compromising current keys does not compromise past messages.
*   **Post-Compromise Security:** Analyzing current traffic does not allow compromising future messages (auto-healing).
*   **Multi-User Simulation:** The UI allows switching between multiple simulated users to test encryption flows easily.

---

## Cryptographic Architecture

The core of this application is its implementation of the Signal Protocol, widely regarded as the gold standard for secure messaging.

### 1. Key Generation (Client-Side)
When a user logs in, the browser generates a set of cryptographic keys using the **Web Crypto API**. These keys never leave the client device (except for public keys).

*   **Identity Key Pair (IK):** A long-term Curve25519 key pair that uniquely identifies the user.
*   **Signed PreKey (SPK):** A medium-term key pair signed by the Identity Key, rotated periodically.
*   **One-Time PreKeys (OPK):** A batch of single-use keys to ensure forward secrecy for initial messages.

### 2. The Initial Handshake (X3DH)
To start a secure chat, the application uses **X3DH (Extended Triple Diffie-Hellman)** to establish a shared secret between two parties who may not be online at the same time.

1.  **Alice** wants to send a message to **Bob**.
2.  Alice fetches Bob's **Public Key Bundle** (Identity Key, Signed PreKey, One-Time PreKey) from the server.
3.  Alice generates an **Ephemeral Key (EK)**.
4.  Alice performs complex Diffie-Hellman calculations:
    *   `DH1 = IK_Alice * SPK_Bob`
    *   `DH2 = EK_Alice * IK_Bob`
    *   `DH3 = EK_Alice * SPK_Bob`
    *   `DH4 = EK_Alice * OPK_Bob`
5.  These values are combined to create the initial **Root Key**.

### 3. Message Encryption (Double Ratchet)
Once the shared secret is established, the **Double Ratchet Algorithm** takes over for every subsequent message. This acts like a "cryptographic gear system" that advances with every message.

*   **Diffie-Hellman Ratchet:** Updates keys every time a round-trip of messages occurs (A->B, then B->A). This provides future secrecy.
*   **Symmetric-Key Ratchet:** Updates keys for every single message sent in a chain to ensure forward secrecy.

Each message is encrypted with a unique, one-time Message Key derived from this process. Even if a key is stolen, it cannot decrypt past messages, and the protocol will "self-heal" after a few new messages.

---

## Technology Stack

### Frontend
*   **Framework:** React (Vite)
*   **Language:** TypeScript
*   **Styling:** CSS
*   **Cryptography:** Web Crypto API (Native browser implementation)

### Backend
*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **Real-Time Engine:** Socket.IO
*   **Database:** MongoDB (via Mongoose)
*   **Containerization:** Docker & Docker Compose

---

## Installation & Setup

### Prerequisites
*   Node.js (v18+)
*   Docker & Docker Compose (optional, for easy database setup)

### 1. Start the Backend & Database

The easiest way to run the backend is with Docker, which sets up both the Node.js server and MongoDB.

```bash
# In the root project directory
docker-compose up --build
```
*   Server runs on: `http://localhost:3001`
*   MongoDB runs on: `mongodb://localhost:27017`

### 2. Start the Frontend

Open a new terminal window:

```bash
cd frontend
npm install
npm run dev
```
*   App runs on: `http://localhost:5173`

---

## How to Demo

1.  **Open User A:** Open `http://localhost:5173` in your browser. Select a user from the dropdown.
2.  **Open User B:** Open a new Incognito window or a different browser at the same URL. Select a user.
3.  **Start Chat:** Select a user from the contact list and send a message.
4.  **Observe:**
    *   The message is encrypted in the browser (look at the console logs).
    *   The encrypted ciphertext travels via the server (server logs show only encrypted data).
    *   Bob's browser receives the ciphertext and decrypts it using his private session keys.

## Disclaimer
This is a **simulation** and educational implementation of the Signal Protocol. While it uses real cryptographic primitives (ECDH, AES-GCM), it is intended for demonstration purposes and has not been security audited for production use.
