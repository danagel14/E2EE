import { webcrypto } from 'crypto';

// In a real browser environment, this would be window.crypto
// For this simulation script (if run in Node), we use the webcrypto polyfill/module
const crypto = (typeof window !== 'undefined' && window.crypto) ? window.crypto : webcrypto as unknown as Crypto;
const subtle = crypto.subtle;

// --- 1. Key Types & Utilities ---

interface KeyPair {
    pub: CryptoKey;
    priv: CryptoKey;
}

interface PreKeyBundle {
    identityKey: CryptoKey;
    signedPreKey: CryptoKey;
    signedPreKeySignature: ArrayBuffer;
    oneTimePreKey?: CryptoKey;
    oneTimePreKeyId?: number;
}

// Helpers for array buffer conversion (for logging)
function ab2str(buf: ArrayBuffer): string {
    return String.fromCharCode.apply(null, new Uint8Array(buf) as any);
}
function str2ab(str: string): ArrayBuffer {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}
function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// --- 2. Cryptographic Primitives ---

// HKDF (HMAC-based Key Derivation Function)
// Used to derive secure keys from a shared secret.
async function hkdf(inputKeyMaterial: ArrayBuffer, salt: ArrayBuffer, info: ArrayBuffer, length: number): Promise<ArrayBuffer> {
    const key = await subtle.importKey("raw", inputKeyMaterial, "HKDF", false, ["deriveBits"]);
    return await subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) },
        key,
        length * 8
    );
}

// HMAC-SHA256
async function hmac(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
    return await subtle.sign("HMAC", key, data);
}

// AES-GCM (Authenticated Encryption)
// Provides confidentiality and integrity.
async function encryptGCM(key: CryptoKey, plaintext: string, associatedData: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer, iv: ArrayBuffer }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await subtle.encrypt(
        { name: "AES-GCM", iv: iv, additionalData: associatedData },
        key,
        encoded
    );
    return { ciphertext, iv };
}

async function decryptGCM(key: CryptoKey, ciphertext: ArrayBuffer, iv: ArrayBuffer, associatedData: ArrayBuffer): Promise<string> {
    const decrypted = await subtle.decrypt(
        { name: "AES-GCM", iv: iv, additionalData: associatedData },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

// Key Generation Helper
async function generateKeyPair(): Promise<KeyPair> {
    const pair = await subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    ) as CryptoKeyPair;
    return { pub: pair.publicKey, priv: pair.privateKey };
}

async function generateSigningKeyPair(): Promise<KeyPair> {
    const pair = await subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
    ) as CryptoKeyPair;
    return { pub: pair.publicKey, priv: pair.privateKey };
}


// --- 3. Double Ratchet Implementation ---

class DoubleRatchet {
    private rootKey: ArrayBuffer;
    private sendChainKey: ArrayBuffer | null = null;
    private recvChainKey: ArrayBuffer | null = null;
    private sendRatchetKey: KeyPair;         // My current ratchet key
    private recvRatchetKey: CryptoKey | null = null; // Other party's current ratchet key

    // Counters
    private sendMsgNum: number = 0;
    private recvMsgNum: number = 0; // Simplified; ideally track per-chain

    private name: string; // For logging

    constructor(name: string) {
        this.name = name;
    }

    // Initialize Alice (Sender of initial message)
    async initAlice(sharedSecret: ArrayBuffer, bobPublicKey: CryptoKey) {
        console.log(`[${this.name}] Initializing with shared secret:`, toHex(sharedSecret).slice(0, 16) + "...");
        this.rootKey = sharedSecret;
        this.recvRatchetKey = bobPublicKey;

        // Alice generates a new ratchet key right away to start the first sending chain
        this.sendRatchetKey = await generateKeyPair();

        // DH Output = ECDH(AliceRatchet, BobRatchet)
        const dhOut = await this.performDiffieHellman(this.sendRatchetKey.priv, this.recvRatchetKey);

        // KDF_RK(rk, dh_out) -> (rk, ck)
        const [newRoot, newChain] = await this.kdfRoot(this.rootKey, dhOut);
        this.rootKey = newRoot;
        this.sendChainKey = newChain;

        console.log(`[${this.name}] Initialized. Root Key derived.`);
    }

    // Initialize Bob (Receiver of initial message)
    async initBob(sharedSecret: ArrayBuffer, bobRatchetKey: KeyPair) {
        console.log(`[${this.name}] Initializing with shared secret:`, toHex(sharedSecret).slice(0, 16) + "...");
        this.rootKey = sharedSecret;
        this.sendRatchetKey = bobRatchetKey; // Bob's 'current' ratchet key is his Signed PreKey or similar (passed in)
        this.recvRatchetKey = null; // Bob hasn't received Alice's ratchet key yet
        this.recvChainKey = null;   // No receive chain yet
        // Bob starts with just the Root Key matching Alice's initial state
    }

    // --- Message handling ---

    public async encryptMessage(plaintext: string): Promise<any> {
        // Symmetric Ratchet: Derive Message Key from Chain Key
        if (!this.sendChainKey) throw new Error("No sending chain key!");

        const [newChainKey, messageKey] = await this.kdfChain(this.sendChainKey);
        this.sendChainKey = newChainKey; // Advance chain

        const mkCryptoKey = await subtle.importKey("raw", messageKey, "AES-GCM", false, ["encrypt"]);

        // Header: My current public ratchet key
        // Note: In strict Signal, header also contains N (msg num) and PN (prev msg num)
        const header = {
            ratchetKey: this.sendRatchetKey.pub,
            n: this.sendMsgNum++
        };

        // Encrypt with Associated Data handling (header authentication)
        // For simulation simplicity, we just encrypt the body.
        // In prod, pass header as AD.
        const { ciphertext, iv } = await encryptGCM(mkCryptoKey, plaintext, new Uint8Array(0));

        console.log(`[${this.name}] Encrypted "${plaintext}" (Chain Step)`);

        return {
            header,
            ciphertext,
            iv
        };
    }

    public async decryptMessage(message: any): Promise<string> {
        const { header, ciphertext, iv } = message;

        // Check if a DH Ratchet step is needed (DHR)
        // If the message contains a new Ratchet Key from the other party

        // Simple check: Do we already have this key? (By importing and comparing, or usually comparing bytes)
        // For simulation, we assume if header.ratchetKey is different from current recvRatchetKey, we step.
        // NOTE: In JS, object comparison checks references. We need a real check. 
        // We'll skip complex key comparison and assume: receive a key -> try to step if it's "new" logic.
        // But here, let's implement the core DHR logic:

        let isNewRatchet = false;
        if (!this.recvRatchetKey) {
            isNewRatchet = true;
        } else {
            // Real impl would compare key bytes. 
            // We will assume for this simulation flow that replies imply safe rotation.
            // Ideally: if (header.ratchetKey != this.recvRatchetKey) ...
            isNewRatchet = true; // Use a flagged approach in a real app
        }

        // --- DH Ratchet Step (Update Root Chain) ---
        // If this simulates receiving a new key:
        if (isNewRatchet) {
            // 1. DHR: KDF_RK(RK, DH(MyRatchet, TheirNewRatchet)) -> (RK, RecvChain)
            // But wait, if I am Bob receiving Alice's first message:
            // Alice sent with A1. Bob has B0.
            // Bob computes DH(B0, A1).

            // Simplification: We assume every received message *might* trigger a step if the key changed.
            // For the sake of this single-file simulation, we will "try" to step if the chain is empty
            // or if we detect a "context switch" (reply).

            // NOTE: This logic is the most complex part of Signal. 
            // We'll implement a simplified "Run DHR if we can't decrypt with current chain" or explicit trigger.

            // Let's force a DHR step for this simulation on *every* reply chain switch.
        }

        // Actually, let's implement the flow Bob follows on first message:
        if (!this.recvChainKey) {
            console.log(`[${this.name}] New Ratchet Key detected. Performing DH Ratchet step...`);
            this.recvRatchetKey = header.ratchetKey;

            // DH = ECDH(MyPriv, TheirPub)
            const dhOut = await this.performDiffieHellman(this.sendRatchetKey.priv, this.recvRatchetKey!);

            // Update Root and Recv Chain
            const [newRoot, newRecvChain] = await this.kdfRoot(this.rootKey, dhOut);
            this.rootKey = newRoot;
            this.recvChainKey = newRecvChain;
            console.log(`[${this.name}] Ratchet Step Complete. New Recv Chain established.`);
        }

        // ... (Logic for handling out-of-order skipped) ...

        // Symmetric Ratchet: Derive Message Key
        const [newChainKey, messageKey] = await this.kdfChain(this.recvChainKey!);
        this.recvChainKey = newChainKey;

        const mkCryptoKey = await subtle.importKey("raw", messageKey, "AES-GCM", false, ["decrypt"]);

        const plaintext = await decryptGCM(mkCryptoKey, ciphertext, iv, new Uint8Array(0));
        console.log(`[${this.name}] Decrypted: "${plaintext}"`);
        return plaintext;
    }

    // --- Helper: Sending a Reply (Rotates Sending Key) ---
    // When responding, we should generate a new keypair to give the other side a new DH output (Post-Compromise Security)
    public async rotateSendingKey() {
        console.log(`[${this.name}] Rotating Sending Key (DHR)...`);
        this.sendRatchetKey = await generateKeyPair();

        if (!this.recvRatchetKey) throw new Error("Cannot rotate sending key without a receiver key to DH against");

        // DH = ECDH(MyNewRatchet, TheirLastRatchet)
        const dhOut = await this.performDiffieHellman(this.sendRatchetKey.priv, this.recvRatchetKey);

        const [newRoot, newSendChain] = await this.kdfRoot(this.rootKey, dhOut);
        this.rootKey = newRoot;
        this.sendChainKey = newSendChain;
        this.sendMsgNum = 0; // Reset count for new chain
    }

    // --- Core Math ---

    private async performDiffieHellman(priv: CryptoKey, pub: CryptoKey): Promise<ArrayBuffer> {
        return await subtle.deriveBits(
            { name: "ECDH", public: pub },
            priv,
            256
        );
    }

    private async kdfRoot(rootKey: ArrayBuffer, dhOut: ArrayBuffer): Promise<[ArrayBuffer, ArrayBuffer]> {
        // Simple KDF using separate info strings
        // In Signal this is KDF_RK
        const salt = new Uint8Array(32); // Should ideally be zero-filled or fixed salt
        const input = await hkdf(dhOut, rootKey, new TextEncoder().encode("Signal-Root"), 64);

        const root = input.slice(0, 32);
        const chain = input.slice(32, 64);
        return [root, chain];
    }

    private async kdfChain(chainKey: ArrayBuffer): Promise<[ArrayBuffer, ArrayBuffer]> {
        // KDF_CK(ck) -> (ck, mk) using HMAC
        const ckCrypto = await subtle.importKey("raw", chainKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

        // Derive new Chain Key (Input: 0x01)
        const newChainKey = await hmac(ckCrypto, new Uint8Array([1]));

        // Derive Message Key (Input: 0x02)
        const messageKey = await hmac(ckCrypto, new Uint8Array([2]));

        return [newChainKey, messageKey];
    }
}

// --- 4. Main Simulation ---

async function runSimulation() {
    console.log("=== Starting E2EE Simulation ===\n");

    // 1. SETUP: Bob publishes keys (Identity, SignedPreKey, OneTimePreKey)
    console.log("--- 1. Key Generation (Bob) ---");
    const bobIdentity = await generateKeyPair();
    const bobSignedPreKey = await generateKeyPair();
    const bobOneTimePreKey = await generateKeyPair();

    // 2. HANDSHAKE: Alice fetches keys and performs X3DH
    console.log("\n--- 2. X3DH Handshake (Alice) ---");
    // Alice generates her identity and ephemeral keys
    const aliceIdentity = await generateKeyPair();
    const aliceEphemeral = await generateKeyPair();

    // Alice calculates Shared Secret (SK)
    // SK = KDF( DH(IKa, SPKb) || DH(EKa, IKb) || DH(EKa, SPKb) || DH(EKa, OPKb) )
    const dh1 = await subtle.deriveBits({ name: "ECDH", public: bobSignedPreKey.pub }, aliceIdentity.priv, 256);
    const dh2 = await subtle.deriveBits({ name: "ECDH", public: bobIdentity.pub }, aliceEphemeral.priv, 256);
    const dh3 = await subtle.deriveBits({ name: "ECDH", public: bobSignedPreKey.pub }, aliceEphemeral.priv, 256);
    const dh4 = await subtle.deriveBits({ name: "ECDH", public: bobOneTimePreKey.pub }, aliceEphemeral.priv, 256);

    const combined = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength + dh4.byteLength);
    combined.set(new Uint8Array(dh1), 0);
    combined.set(new Uint8Array(dh2), dh1.byteLength);
    combined.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);
    combined.set(new Uint8Array(dh4), dh1.byteLength + dh2.byteLength + dh3.byteLength);

    const sharedSecret = await subtle.digest("SHA-256", combined);
    console.log("Alice calculated Shared Secret:", toHex(sharedSecret).slice(0, 16) + "...");

    // 3. INITIALIZATION: Alice inits her Ratchet
    const aliceRatchet = new DoubleRatchet("Alice");
    await aliceRatchet.initAlice(sharedSecret, bobSignedPreKey.pub);
    // Note: Alice uses Bob's SPK (or result of handshake) as his initial "Ratchet Key" reference

    // 4. MESSAGING: Alice sends 3 messages
    console.log("\n--- 3. Alice Sending Messages (Symmetric Ratchet) ---");

    // Message 1
    const msg1 = await aliceRatchet.encryptMessage("Hello Bob!");

    // Message 2
    const msg2 = await aliceRatchet.encryptMessage("This is E2EE.");

    // Message 3
    const msg3 = await aliceRatchet.encryptMessage("Secure and verified.");

    // 5. RECEIVING: Bob performs X3DH receiver-side and inits
    console.log("\n--- 4. Bob Receiving (DH Ratchet Init) ---");

    // Bob repeats X3DH logic to get same secret
    const r_dh1 = await subtle.deriveBits({ name: "ECDH", public: aliceIdentity.pub }, bobSignedPreKey.priv, 256);
    const r_dh2 = await subtle.deriveBits({ name: "ECDH", public: aliceEphemeral.pub }, bobIdentity.priv, 256);
    const r_dh3 = await subtle.deriveBits({ name: "ECDH", public: aliceEphemeral.pub }, bobSignedPreKey.priv, 256);
    const r_dh4 = await subtle.deriveBits({ name: "ECDH", public: aliceEphemeral.pub }, bobOneTimePreKey.priv, 256);

    const r_combined = new Uint8Array(r_dh1.byteLength + r_dh2.byteLength + r_dh3.byteLength + r_dh4.byteLength);
    r_combined.set(new Uint8Array(r_dh1), 0);
    r_combined.set(new Uint8Array(r_dh2), r_dh1.byteLength);
    r_combined.set(new Uint8Array(r_dh3), r_dh1.byteLength + r_dh2.byteLength);
    r_combined.set(new Uint8Array(r_dh4), r_dh1.byteLength + r_dh2.byteLength + r_dh3.byteLength);

    const bobSharedSecret = await subtle.digest("SHA-256", r_combined);
    console.log("Bob derived Shared Secret:  ", toHex(bobSharedSecret).slice(0, 16) + "...");

    if (toHex(sharedSecret) !== toHex(bobSharedSecret)) throw new Error("Shared Secrets Discrepancy!");

    const bobRatchet = new DoubleRatchet("Bob");
    await bobRatchet.initBob(bobSharedSecret, bobSignedPreKey);
    // Bob simulates having "header.ratchetKey" (Alice's new key) coming in msg 1

    // Decrypt messages
    await bobRatchet.decryptMessage(msg1); // Triggers DHR step 1
    await bobRatchet.decryptMessage(msg2); // Symmetric step
    await bobRatchet.decryptMessage(msg3); // Symmetric step

    // 6. REPLY: Bob replies (Triggers Sending Chain update)
    console.log("\n--- 5. Bob Replying (Diffie-Hellman Ratchet Step) ---");
    // Bob needs to rotate key to send
    await bobRatchet.rotateSendingKey();
    const reply1 = await bobRatchet.encryptMessage("Hi Alice! Got your messages.");

    // Alice receives
    console.log("\n--- 6. Alice Receiving Reply ---");
    await aliceRatchet.decryptMessage(reply1); // Triggers Alice's DHR (Recv side)

    console.log("\n=== Simulation Complete. All Checks Passed. ===");
}

// Call simulation if we are in environment
runSimulation().catch(console.error);
