import { arrayBufferToBase64, base64ToArrayBuffer, hkdf, exportPublicKey, importPublicKey, exportPrivateKey, importPrivateKey, exportSymmetricKey, importSymmetricKey } from './web-crypto-utils';

// Types for Double Ratchet State
interface RatchetState {
    RK: ArrayBuffer; // Root Key (now raw bytes)
    CKs: ArrayBuffer | null; // Chain Key (Sending) (now raw bytes)
    CKr: ArrayBuffer | null;
    Ns: number;
    Nr: number;
    PN: number;
    DHs: CryptoKeyPair;
    DHr: CryptoKey | null;
    MKSKIPPED: Map<string, CryptoKey>;
}

interface MessageHeader {
    dh: string;
    n: number;
    pn: number;
}

interface MessagePayload {
    header: MessageHeader;
    ciphertext: string;
}

// const MAX_SKIP = 10; // Max number of skipped messages to track per chain

export class DoubleRatchet {
    private state: RatchetState | null = null;
    // private initPromise: Promise<void> | null = null;

    constructor() { }

    async init(sharedSecret: string, role: 'initiator' | 'responder') {
        // Initial setup for the simplified ratchet (Alice starts sending)
        const srBuffer = base64ToArrayBuffer(sharedSecret);
        const rk = srBuffer;

        // Derive initial Chain Keys from the Shared Secret (RK)
        const salt = new Uint8Array(rk);
        const infoInit = new TextEncoder().encode("CK-Initiator");
        const infoResp = new TextEncoder().encode("CK-Responder");

        // Use the RK as salt, and distinct info for each chain
        const ck_initiator = await hkdf(salt.buffer, new Uint8Array(32).buffer, infoInit.buffer, 32);
        const ck_responder = await hkdf(salt.buffer, new Uint8Array(32).buffer, infoResp.buffer, 32);

        let CKr = null;
        let CKs = null;

        if (role === 'initiator') {
            CKs = ck_initiator;
            CKr = ck_responder;
        } else {
            CKs = ck_responder;
            CKr = ck_initiator;
        }

        // Generate our first DH pair
        const dhPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveBits"]
        ) as CryptoKeyPair;

        this.state = {
            RK: rk,
            CKs: CKs,
            CKr: CKr,
            Ns: 0,
            Nr: 0,
            PN: 0,
            DHs: dhPair,
            DHr: null,
            MKSKIPPED: new Map()
        };
    }

    // --- KDF Helper Functions ---

    // KDF_RK(RK, DH_out): Returns [RK, CK] (as ArrayBuffers)
    private async kdf_rk(rk: ArrayBuffer, dh_out: ArrayBuffer): Promise<[ArrayBuffer, ArrayBuffer]> {
        // RK is already salt (raw bytes)
        const salt = new Uint8Array(rk);

        // HKDF(salt=RK, ikm=dh_out, info="Root Key") -> New RK
        // HKDF(salt=RK, ikm=dh_out, info="Chain Key") -> New CK

        const infoRK = new TextEncoder().encode("Root Key");
        const infoCK = new TextEncoder().encode("Chain Key");

        const new_rk = await hkdf(salt.buffer, dh_out, infoRK.buffer, 32);
        const new_ck = await hkdf(salt.buffer, dh_out, infoCK.buffer, 32);

        return [new_rk, new_ck];
    }

    // KDF_CK(CK): Returns [CK, MK] (CK is ArrayBuffer, MK is CryptoKey)
    private async kdf_ck(ck: ArrayBuffer): Promise<[ArrayBuffer, CryptoKey]> {
        const salt = new Uint8Array(0); // Constant zero salt 
        const ikm = ck;

        const infoMK = new TextEncoder().encode("Message Key");
        const infoCK = new TextEncoder().encode("Chain Key");

        // Message Key
        const mk_bytes = await hkdf(salt.buffer, ikm, infoMK.buffer, 32);
        // Next Chain Key
        const next_ck_bytes = await hkdf(salt.buffer, ikm, infoCK.buffer, 32);

        // MK needs to be imported as AES-GCM key for encryption
        const mk = await window.crypto.subtle.importKey(
            "raw",
            mk_bytes,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );

        return [next_ck_bytes, mk];
    }

    // --- Encryption ---

    async encrypt(plaintext: string): Promise<string> {
        if (!this.state) throw new Error("Ratchet not initialized");

        // 1. Symmetric Ratchet Step: Get Message Key
        if (!this.state.CKs) throw new Error("Sending Chain Key missing"); // Should be set in init

        const [next_cks, mk] = await this.kdf_ck(this.state.CKs);
        this.state.CKs = next_cks;

        // 2. Encrypt
        const header: MessageHeader = {
            dh: await exportPublicKey(this.state.DHs.publicKey),
            n: this.state.Ns,
            pn: this.state.PN
        };
        this.state.Ns++;

        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const ciphertextBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            mk,
            data
        );

        const ivBase64 = arrayBufferToBase64(iv.buffer);
        const ctBase64 = arrayBufferToBase64(ciphertextBuffer);

        const payload: MessagePayload = {
            header,
            ciphertext: `${ivBase64}.${ctBase64}`
        };

        return JSON.stringify(payload);
    }

    // --- Decryption ---

    async decrypt(payload: string): Promise<string> {
        if (!this.state) throw new Error("Ratchet not initialized");

        let msg: MessagePayload;
        try {
            msg = JSON.parse(payload);
        } catch {
            return payload; // Fallback
        }

        const { header, ciphertext: fullCiphertext } = msg;

        // 1. Check for DH Ratchet Step
        if (!this.state.DHr) {
            this.state.DHr = await importPublicKey(header.dh);
        }
        else if (header.dh !== await exportPublicKey(this.state.DHr)) {
            // New key from sender -> DHR Step
            const their_dh_pub = await importPublicKey(header.dh);

            // Step A: Calculate DH output
            const dh_out = await window.crypto.subtle.deriveBits(
                { name: "ECDH", public: their_dh_pub },
                this.state.DHs.privateKey,
                256
            );

            // Step B: KDF_RK(RK, dh_out) -> New Root Key, New Receiver Chain Key
            const [new_rk, new_ckr] = await this.kdf_rk(this.state.RK, dh_out);
            this.state.RK = new_rk;
            this.state.CKr = new_ckr;

            // Step C: Update state
            this.state.DHr = their_dh_pub;
            this.state.Nr = 0;
            this.state.PN = header.pn;

            // Step D: Advertised new DH key
            this.state.DHs = await window.crypto.subtle.generateKey(
                { name: "ECDH", namedCurve: "P-256" },
                true,
                ["deriveBits"]
            ) as CryptoKeyPair;

            // Step E: Calculate Sending Chain Key for *my next reply*
            const dh_out_send = await window.crypto.subtle.deriveBits(
                { name: "ECDH", public: their_dh_pub },
                this.state.DHs.privateKey,
                256
            );
            const [new_rk_send, new_cks] = await this.kdf_rk(this.state.RK, dh_out_send);
            this.state.RK = new_rk_send;
            this.state.CKs = new_cks;
            this.state.Ns = 0;
            this.state.PN = header.n;
        }

        // 2. Symmetric Ratchet
        let mk: CryptoKey | null = null;

        if (this.state.CKr) {
            const [next_ckr, msg_key] = await this.kdf_ck(this.state.CKr);
            this.state.CKr = next_ckr;
            this.state.Nr++;
            mk = msg_key;
        } else {
            throw new Error("Missing Chain Key for decryption");
        }

        // 3. Decrypt
        if (!fullCiphertext.includes('.')) return fullCiphertext;
        const [ivBase64, dataBase64] = fullCiphertext.split('.');
        const iv = base64ToArrayBuffer(ivBase64);
        const data = base64ToArrayBuffer(dataBase64);

        try {
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                mk,
                data
            );
            return new TextDecoder().decode(decryptedBuffer);
        } catch (e) {
            console.error("Ratchet Decryption failed", e);
            throw new Error("Failed to decrypt message (Ratchet step failed)");
        }
    }
    async serialize(): Promise<string> {
        if (!this.state) return "";

        const mkSkippedObj: { [key: string]: string } = {};
        for (const [key, value] of this.state.MKSKIPPED.entries()) {
            mkSkippedObj[key] = await exportSymmetricKey(value);
        }

        const stateObj = {
            RK: arrayBufferToBase64(this.state.RK),
            CKs: this.state.CKs ? arrayBufferToBase64(this.state.CKs) : null,
            CKr: this.state.CKr ? arrayBufferToBase64(this.state.CKr) : null,
            Ns: this.state.Ns,
            Nr: this.state.Nr,
            PN: this.state.PN,
            DHs: {
                privateKey: await exportPrivateKey(this.state.DHs.privateKey),
                publicKey: await exportPublicKey(this.state.DHs.publicKey)
            },
            DHr: this.state.DHr ? await exportPublicKey(this.state.DHr) : null,
            MKSKIPPED: mkSkippedObj
        };

        return JSON.stringify(stateObj);
    }

    async deserialize(json: string): Promise<void> {
        if (!json) return;
        const obj = JSON.parse(json);

        const mkSkippedMap = new Map<string, CryptoKey>();
        for (const key in obj.MKSKIPPED) {
            mkSkippedMap.set(key, await importSymmetricKey(obj.MKSKIPPED[key]));
        }

        this.state = {
            RK: base64ToArrayBuffer(obj.RK),
            CKs: obj.CKs ? base64ToArrayBuffer(obj.CKs) : null,
            CKr: obj.CKr ? base64ToArrayBuffer(obj.CKr) : null,
            Ns: obj.Ns,
            Nr: obj.Nr,
            PN: obj.PN,
            DHs: {
                privateKey: await importPrivateKey(obj.DHs.privateKey),
                publicKey: await importPublicKey(obj.DHs.publicKey)
            },
            DHr: obj.DHr ? await importPublicKey(obj.DHr) : null,
            MKSKIPPED: mkSkippedMap
        };
    }
}
