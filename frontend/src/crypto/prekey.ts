import { exportPublicKey, exportPrivateKey, arrayBufferToBase64 } from './web-crypto-utils';
import { KeyPair } from './identity';

export interface SignedPreKey {
    keyId: number;
    keyPair: KeyPair;
    signature: string; // Base64 signature
}

export interface OneTimePreKey {
    keyId: number;
    keyPair: KeyPair;
}

export class SignedPreKeyGenerator {
    static async generate(keyId: number, identityPrivateKey: CryptoKey): Promise<SignedPreKey> {
        // 1. Generate the PreKey Pair (ECDH)
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256",
            },
            true,
            ["deriveKey", "deriveBits"]
        ) as CryptoKeyPair;

        const pubKeyBuffer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);

        // Import Identity Key as ECDSA for signing
        const identityPrivKeyExport = await window.crypto.subtle.exportKey("pkcs8", identityPrivateKey);
        const signingKey = await window.crypto.subtle.importKey(
            "pkcs8",
            identityPrivKeyExport,
            {
                name: "ECDSA",
                namedCurve: "P-256",
            },
            true,
            ["sign"]
        );

        const signature = await window.crypto.subtle.sign(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" },
            },
            signingKey,
            pubKeyBuffer
        );

        return {
            keyId,
            keyPair: {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
                publicKeyBase64: arrayBufferToBase64(pubKeyBuffer),
                privateKeyBase64: await exportPrivateKey(keyPair.privateKey)
            },
            signature: arrayBufferToBase64(signature)
        };
    }
}

export class OneTimePreKeyGenerator {
    static async generate(keyId: number): Promise<OneTimePreKey> {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256",
            },
            true,
            ["deriveKey", "deriveBits"]
        ) as CryptoKeyPair;

        return {
            keyId,
            keyPair: {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
                publicKeyBase64: await exportPublicKey(keyPair.publicKey),
                privateKeyBase64: await exportPrivateKey(keyPair.privateKey)
            }
        };
    }

    static async generateBatch(count: number, startId: number = 0): Promise<OneTimePreKey[]> {
        const promises = [];
        for (let i = 0; i < count; i++) {
            promises.push(this.generate(startId + i));
        }
        return Promise.all(promises);
    }
}