# E2EE Chat - Complete Setup and Testing Guide

Complete guide to running and testing your End-to-End Encrypted chat application with X3DH handshake.

---

## 📋 Prerequisites

Before starting, ensure you have:
- **Node.js** v22.6.0 or higher
- **npm** (comes with Node.js)
- A modern web browser (Chrome, Firefox, Edge)
- Terminal/Command Prompt access

---

## 🚀 Step 1: Installation

### 1.1 Install Server Dependencies

```bash
cd server
npm install
```

**Expected output:**
```
added XX packages
```

### 1.2 Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

**Expected output:**
```
added XX packages
```

---

## 🔧 Step 2: Build Verification (Optional but Recommended)

Before running, verify TypeScript compilation:

```bash
# From frontend directory
npx tsc --noEmit
```

**Expected output:** No errors (command completes silently)

**If you see errors:** All TypeScript errors should already be fixed. If not, report them.

---

## 🎯 Step 3: Run the X3DH Test (Verify Crypto Works)

Test the cryptographic implementation BEFORE running the full application:

```bash
# From project root (E2EE-1 directory)
cd ..
npx tsx test-x3dh.ts
```

### ✅ Expected Output:

```
🔐 Starting X3DH Handshake Test

═══════════════════════════════════════════════════════════

📱 ALICE (Sender) - Generating Keys...
✅ Alice Identity Key generated

📱 BOB (Receiver) - Generating Keys...
✅ Bob Identity Key generated
✅ Bob Signed PreKey generated
✅ Bob One-Time PreKeys generated (5 keys)

🔐 ALICE - Initiating X3DH Handshake...
✅ Alice derived shared secret
   Length: 32 bytes, First 4 bytes: XX XX XX XX

🔐 BOB - Restoring Shared Secret...
✅ Bob restored shared secret
   Length: 32 bytes, First 4 bytes: XX XX XX XX

🔍 VERIFICATION - Comparing Shared Secrets...
✅ Shared secrets match perfectly
   ✨ X3DH handshake successful!

⚙️  DOUBLE RATCHET - Initializing...
✅ Alice ratchet initialized
✅ Bob ratchet initialized

💬 MESSAGE ENCRYPTION - Testing...
   Original: "Hello, this is a secure E2EE message! 🔒"
✅ Message encrypted
   Ciphertext length: XX bytes
   Decrypted: "Hello, this is a secure E2EE message! 🔒"
✅ Message decrypted correctly

🔄 MULTIPLE MESSAGES - Testing Key Ratcheting...
✅ Message 1 encrypted/decrypted
✅ Message 2 encrypted/decrypted
✅ Message 3 encrypted/decrypted

═══════════════════════════════════════════════════════════

🎉 ALL TESTS PASSED! 🎉

✅ X3DH Handshake: Working
✅ Shared Secret Derivation: Matching
✅ Double Ratchet: Functioning
✅ Message Encryption: Successful
✅ Key Ratcheting: Operating correctly

🔐 Your E2EE implementation is working perfectly!
```

### ❌ If Test Fails:

If you see errors, the issue is in your cryptographic implementation. Common issues:
- **"Shared secrets do not match"** → X3DH implementation error
- **"Module not found"** → Run `npm install` again
- **"Buffer is not defined"** → Already fixed, but check `crypto-utils.ts`

---

## 🖥️ Step 4: Run the Server

Open a **NEW terminal window** and run:

```bash
cd server
npm start
```

### ✅ Expected Output:

```
Server running on port 3001
MongoDB Connected: mongodb://127.0.0.1:27017/e2ee-chat
Socket.IO server ready
```

**Keep this terminal window open!** The server must keep running.

### Common Server Issues:

| Error | Solution |
|-------|----------|
| `Port 3001 already in use` | Kill the process: `npx kill-port 3001` |
| `MongoDB connection error` | Check MongoDB is running: `mongod --version` |
| `Cannot find module` | Run `npm install` in server directory |

---

## 🌐 Step 5: Run the Frontend

Open **ANOTHER NEW terminal window** and run:

```bash
cd frontend
npm run dev
```

### ✅ Expected Output:

```
VITE v5.0.0  ready in XXX ms

➜  Local:   http://localhost:3000/
➜  Network: use --host to expose
➜  press h to show help
```

**Keep this terminal window open too!**

---

## 🧪 Step 6: Test the E2EE Application

Now test the complete E2EE flow with real users.

### 6.1 Open Two Browser Windows

1. **Open Window 1 (Regular):**
   - Navigate to `http://localhost:3000`
   - Open DevTools (F12) → Go to **Console** tab

2. **Open Window 2 (Incognito/Private):**
   - Press `Ctrl+Shift+N` (Chrome) or `Ctrl+Shift+P` (Firefox)
   - Navigate to `http://localhost:3000`
   - Open DevTools (F12) → Go to **Console** tab

**Why Incognito?** To simulate two different users with separate localStorage.

---

### 6.2 Set Different Users

**Window 1 (Alice):**
1. Look at the top bar: "אני מחובר כ"
2. Select **"רז בן לולו"** from dropdown
3. Wait 1-2 seconds

**Window 2 (Bob):**
1. Select **"תומר פורת"** from dropdown
2. Wait 1-2 seconds

---

### 6.3 Check Console Logs (Key Generation)

**Both windows should show:**

```javascript
✅ Keys uploaded to server
Connected to Socket.IO server, id: XXXXXXXXX
```

**This means:**
- ✅ Keys were generated locally
- ✅ Public keys uploaded to server
- ✅ WebSocket connection established

---

### 6.4 Initiate Chat from Window 1 (Alice)

**In Window 1:**
1. Click the **"+"** button (bottom left)
2. Select **"תומר פורת"** from contacts
3. Type message: `Hello Bob, this is Alice! 🔒`
4. Press Send

---

### 6.5 Watch Console Logs - X3DH Handshake

**Window 1 (Alice - Sender) Console should show:**

```javascript
Protocol: Initializing session with 2
Orchestrating X3DH handshake...
Fetching keys for: 2
Protocol: Session established (Sender side)
Encrypted message sent: dGVzdA==.YWJjZGVm... (Base64 ciphertext)
```

**This means:**
- ✅ Alice fetched Bob's public key bundle from server
- ✅ Alice performed X3DH handshake (sender side)
- ✅ Shared secret derived
- ✅ Message encrypted with AES-GCM
- ✅ Ciphertext sent to server

---

**Window 2 (Bob - Receiver) Console should show:**

```javascript
Received session request from 4
Protocol: Handling session request from 4
Protocol: Session established (Receiver side)
✅ Decrypted message: Hello Bob, this is Alice! 🔒
```

**This means:**
- ✅ Bob received X3DH session request from Alice
- ✅ Bob restored shared secret (receiver side)
- ✅ Shared secrets matched (handshake successful!)
- ✅ Message decrypted correctly

---

### 6.6 Verify Message Appears

**Window 2 should display:**
- Message bubble with: "Hello Bob, this is Alice! 🔒"
- Timestamp on the right

---

### 6.7 Send Reply (Test Two-Way Communication)

**In Window 2 (Bob):**
1. Type: `Hi Alice! E2EE is working! 🎉`
2. Press Send

**Window 1 Console should show:**
```javascript
✅ Decrypted message: Hi Alice! E2EE is working! 🎉
```

**This confirms:**
- ✅ Session is established both ways
- ✅ Encryption/decryption working in both directions
- ✅ Key ratcheting functioning

---

## 🔍 Step 7: Verify Encryption (Advanced)

### 7.1 Check Network Traffic

**In Window 1:**
1. Open DevTools → **Network** tab
2. Filter by **WS** (WebSocket)
3. Click on the `socket.io` connection
4. Go to **Messages** tab
5. Find a `send-message` event

**You should see:**
```json
["send-message", {
  "from": "4",
  "to": "2",
  "ciphertext": "MTIzNDU2Nzg5MGFi.ZGVmZ2hpamtsbW5vcA=="
}]
```

**IMPORTANT:** 
- ✅ Only ciphertext is visible (Base64 encoded)
- ✅ Original message is NOT visible
- ✅ This proves messages are encrypted

---

### 7.2 Check Server Logs

**In your server terminal, you should see:**
```
Registered user: 4
Registered user: 2
Relaying message from 4 to 2
Relaying message from 2 to 4
```

**IMPORTANT:**
- ✅ Server logs should NOT show message content
- ✅ Only shows "from" and "to" user IDs
- ✅ This proves server cannot read messages

---

### 7.3 Check localStorage (Keys Stored)

**In Window 1 Console, run:**
```javascript
Object.keys(localStorage).filter(k => k.startsWith('e2ee_keys_'))
```

**You should see:**
```javascript
[
  "e2ee_keys_4_identityPublic",
  "e2ee_keys_4_identityPrivate",
  "e2ee_keys_4_signedPreKeyId",
  "e2ee_keys_4_signedPreKeyPublic",
  "e2ee_keys_4_signedPreKeyPrivate",
  "e2ee_keys_4_signedPreKeySignature",
  "e2ee_keys_4_oneTimePreKeys"
]
```

**This confirms:**
- ✅ All keys generated and stored locally
- ✅ Private keys never leave the browser

---

## ✅ Success Checklist

Mark each item as you verify it:

### Cryptographic Tests
- [ ] `npx tsx test-x3dh.ts` shows "ALL TESTS PASSED"
- [ ] Shared secrets match perfectly
- [ ] Message encryption/decryption works
- [ ] Key ratcheting tested with multiple messages

### Server
- [ ] Server starts without errors on port 3001
- [ ] MongoDB connection successful
- [ ] Socket.IO server ready

### Frontend
- [ ] Frontend builds and runs on port 5173
- [ ] No TypeScript compilation errors
- [ ] DevTools Console shows no errors

### E2EE Flow
- [ ] Keys generated and uploaded for both users
- [ ] "Session established (Sender side)" appears
- [ ] "Session established (Receiver side)" appears
- [ ] Messages encrypted (check Network tab - only ciphertext visible)
- [ ] Messages decrypted correctly
- [ ] Two-way communication works
- [ ] Server logs don't show plaintext messages

### All Checked? 🎉
**Your E2EE chat application is fully functional!**

---

## 🐛 Troubleshooting

### Issue: "Cannot connect to server"
- ✅ Check server is running on port 3001
- ✅ Check `http://localhost:3001` returns a response

### Issue: "Keys not found"
- ✅ Clear localStorage: `localStorage.clear()`
- ✅ Refresh the page
- ✅ Keys will regenerate automatically

### Issue: "[Decryption Error]" in console
- ✅ Shared secrets didn't match
- ✅ Clear localStorage on both windows
- ✅ Refresh both windows
- ✅ Try X3DH handshake again

### Issue: TypeScript errors
- ✅ All errors should be fixed already
- ✅ Run `npx tsc --noEmit` to check
- ✅ If errors appear, re-check the error messages

### Issue: Port already in use
```bash
# Kill port 3001
npx kill-port 3001

# Kill port 5173
npx kill-port 5173
```

---

## 📚 What You've Tested

1. ✅ **X3DH Handshake**: Sender and receiver derive matching shared secrets
2. ✅ **Key Derivation**: DH operations, HKDF, SHA-256 hashing
3. ✅ **Double Ratchet**: Chain key evolution, message key derivation
4. ✅ **AES-GCM Encryption**: Authenticated encryption with unique IV
5. ✅ **Key Ratcheting**: Each message uses different key
6. ✅ **Client-Side Crypto**: All operations in browser
7. ✅ **Server Relay**: Server cannot decrypt messages

---

## 🎓 Next Steps

**Your E2EE implementation is complete!** Consider:
- Adding more test cases
- Implementing message persistence (encrypted backups)
- Adding typing indicators
- Implementing read receipts
- Adding group chat support
- Deploying to production

**Questions?** Check `TESTING.md` for detailed debugging information.

