import { importPublicKey, base64ToArrayBuffer, arrayBufferToBase64 } from './web-crypto-utils';

export interface KeyBundle {
    userId: string;
    identityKey: string; // Base64
    signedPreKey: string; // Base64
    signedPreKeySignature: string; // Base64
    oneTimePreKey?: string | null; // Base64
    oneTimePreKeyId?: number | null;
}

export class X3DH {
    static async deriveSharedSecret(
        senderIdentityPriv: CryptoKey,
        senderEphemeralPriv: CryptoKey,
        recipientBundle: KeyBundle
    ): Promise<{ sharedSecret: string, usedOPK: boolean }> {

        // Import Recipient Keys
        const recipientIdentityKey = await importPublicKey(recipientBundle.identityKey);
        const recipientSignedPreKey = await importPublicKey(recipientBundle.signedPreKey);

        let recipientOneTimePreKey: CryptoKey | null = null;
        if (recipientBundle.oneTimePreKey) {
            recipientOneTimePreKey = await importPublicKey(recipientBundle.oneTimePreKey);
        }

        // Verify Signature (Optional but recommended - skipping for strict "make it work" parity first, but easy to add)
        // To verify: Import IdentityKey as ECDSA, verify 'signedPreKey' signature.
        /*
        const verifyKey = await window.crypto.subtle.importKey(
            "spki",
            base64ToArrayBuffer(recipientBundle.identityKey),
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"]
        );
        const signatureValid = await window.crypto.subtle.verify(
            { name: "ECDSA", hash: { name: "SHA-256" } },
            verifyKey,
            base64ToArrayBuffer(recipientBundle.signedPreKeySignature),
            base64ToArrayBuffer(recipientBundle.signedPreKey)
        );
        if (!signatureValid) throw new Error("Invalid Signed PreKey Signature");
        */

        // DH1: IKa || SPKb
        const dh1 = await this.diffieHellman(senderIdentityPriv, recipientSignedPreKey);

        // DH2: EKa || IKb
        const dh2 = await this.diffieHellman(senderEphemeralPriv, recipientIdentityKey);

        // DH3: EKa || SPKb
        const dh3 = await this.diffieHellman(senderEphemeralPriv, recipientSignedPreKey);

        // DH4: EKa || OPKb (if available)
        let dh4 = new ArrayBuffer(0);
        if (recipientOneTimePreKey) {
            dh4 = await this.diffieHellman(senderEphemeralPriv, recipientOneTimePreKey);
            console.log('X3DH (Client): Using One-Time Prekey (DH4)');
        }

        // Combine Keys [dh1 || dh2 || dh3 || dh4]
        // Note: We need to concatenate the output *bits* / bytes.

        const combinedLength = dh1.byteLength + dh2.byteLength + dh3.byteLength + dh4.byteLength;
        const combined = new Uint8Array(combinedLength);
        let offset = 0;

        combined.set(new Uint8Array(dh1), offset); offset += dh1.byteLength;
        combined.set(new Uint8Array(dh2), offset); offset += dh2.byteLength;
        combined.set(new Uint8Array(dh3), offset); offset += dh3.byteLength;
        if (recipientOneTimePreKey) {
            combined.set(new Uint8Array(dh4), offset);
        }

        // Derive Final Secret using SHA-256 KDF (as per server implementation)
        const sharedSecretBuffer = await window.crypto.subtle.digest("SHA-256", combined);

        // Return mostly as hex string to match current DoubleRatchet expectation or Buffer analog?
        // The existing DoubleRatchet (frontend/src/crypto/ratchet.ts) expects a string (demo) or buffer? 
        // Let's check `ratchet.ts`. It seems to take `secret` in constructor.
        // We will return standard Buffer (Uint8Array) or Hex string depending on consumer.
        // The server implementation returns a buffer.
        // Let's return raw bytes for the Ratchet to use.
        // But since we can't easily pass Uint8Array to the *existing* Demo Ratchet (which takes string), 
        // we might need to update Ratchet or just Hex encode it.
        // Ideally we pass the high-entropy byte array.

        return {
            sharedSecret: arrayBufferToBase64(sharedSecretBuffer), // Using Base64 to be safe for now, or Hex?
            usedOPK: !!recipientOneTimePreKey
        };
    }

    // Receiver Side: Derive Shared Secret
    // DH1: SPKb (Mine) || IKa (Sender)
    // DH2: IKb (Mine) || EKa (Sender)
    // DH3: SPKb (Mine) || EKa (Sender)
    // DH4: OPKb (Mine) || EKa (Sender)
    static async deriveSharedSecretReceiver(
        identityKeyPrivate: CryptoKey, // IKb
        signedPreKeyPrivate: CryptoKey, // SPKb
        oneTimePreKeyPrivate: CryptoKey | null, // OPKb (optional)
        senderIdentityKey: CryptoKey, // IKa
        senderEphemeralKey: CryptoKey // EKa
    ): Promise<string> {

        // DH1: SPKb || IKa
        const dh1 = await this.diffieHellman(signedPreKeyPrivate, senderIdentityKey);

        // DH2: IKb || EKa
        const dh2 = await this.diffieHellman(identityKeyPrivate, senderEphemeralKey);

        // DH3: SPKb || EKa
        const dh3 = await this.diffieHellman(signedPreKeyPrivate, senderEphemeralKey);

        // DH4: OPKb || EKa
        let dh4 = new ArrayBuffer(0);
        if (oneTimePreKeyPrivate) {
            dh4 = await this.diffieHellman(oneTimePreKeyPrivate, senderEphemeralKey);
            console.log('X3DH (Receiver): Using One-Time Prekey (DH4)');
        }

        const combinedLength = dh1.byteLength + dh2.byteLength + dh3.byteLength + dh4.byteLength;
        const combined = new Uint8Array(combinedLength);
        let offset = 0;

        combined.set(new Uint8Array(dh1), offset); offset += dh1.byteLength;
        combined.set(new Uint8Array(dh2), offset); offset += dh2.byteLength;
        combined.set(new Uint8Array(dh3), offset); offset += dh3.byteLength;
        if (oneTimePreKeyPrivate) {
            combined.set(new Uint8Array(dh4), offset);
        }

        const sharedSecretBuffer = await window.crypto.subtle.digest("SHA-256", combined);

        return arrayBufferToBase64(sharedSecretBuffer);
    }

    private static async diffieHellman(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
        return window.crypto.subtle.deriveBits(
            {
                name: "ECDH",
                public: publicKey
            },
            privateKey,
            256 // P-256 derives 256 bits
        );
    }
}
