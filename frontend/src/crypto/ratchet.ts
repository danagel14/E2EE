import { arrayBufferToBase64, base64ToArrayBuffer } from './web-crypto-utils';

export class DoubleRatchet {
    private rootKey: CryptoKey | null = null;
    private chainKey: CryptoKey | null = null;
    private messageNumber: number = 0;

    // For demo simplicity, we'll keep a list of message keys derived.
    // In a real implementation, you'd have sending and receiving chains.
    // Here we will use the "Shared Secret" as a symmetric key directly for AES-GCM 
    // to simulate the "Ratchet" effect for the MVP without full signal protocol complexity.
    // Real Signal Protocol has Root Chain + Sender Chain + Receiver Chain.

    private sharedSecret: CryptoKey | null = null;

    constructor() { }

    async init(sharedSecretBase64: string) {
        // Import the shared secret as a raw key for AES-GCM
        // Ideally we'd use HKDF to derive Root Key, but for MVP we use it as the master key
        const keyBuffer = base64ToArrayBuffer(sharedSecretBase64);

        this.sharedSecret = await window.crypto.subtle.importKey(
            "raw",
            keyBuffer,
            { name: "AES-GCM" },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async encrypt(plaintext: string): Promise<string> {
        if (!this.sharedSecret) throw new Error("Ratchet not initialized");

        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        // IV should be unique per message. We can use messageNumber mixed with something or just random.
        // For security, random IV is best, sent along with message.
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const ciphertextBuffer = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            this.sharedSecret,
            data
        );

        const ivBase64 = arrayBufferToBase64(iv);
        const ciphertextBase64 = arrayBufferToBase64(ciphertextBuffer);

        this.messageNumber++;

        // Format: IV.Ciphertext
        return `${ivBase64}.${ciphertextBase64}`;
    }

    async decrypt(ciphertext: string): Promise<string> {
        if (!this.sharedSecret) throw new Error("Ratchet not initialized");

        if (!ciphertext.includes('.')) return ciphertext; // Return as is if not formatted

        const [ivBase64, dataBase64] = ciphertext.split('.');

        const iv = base64ToArrayBuffer(ivBase64);
        const data = base64ToArrayBuffer(dataBase64);

        try {
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                this.sharedSecret,
                data
            );

            const decoder = new TextDecoder();
            return decoder.decode(decryptedBuffer);
        } catch (e) {
            console.error("Decryption failed", e);
            throw new Error("Failed to decrypt message");
        }
    }
}
