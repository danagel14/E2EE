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

        // 2. Sign the Public Key with Identity Private Key
        // We need an ECDSA Identity Key for signing. 
        // NOTE: The current architecture uses ECDH for Identity Keys ( Curve25519 style X3DH).
        // Standard X3DH uses Curve25519 for everything. 
        // If we are using P-256 (NIST), we usually use ECDSA for signing and ECDH for key agreement.
        // However, the existing server implementation uses 'prime256v1' (P-256) for *everything* via Node's `crypto.generateKeyPairSync('ec', ...)`.
        // Node's `crypto` object works slightly differently.
        // In Web Crypto, ECDH keys CANNOT sign. ECDSA keys CANNOT derive bits.
        // This suggests the original server logic might have implicit assumptions or Node allows using the same key material for different algos if not strictly enforced?
        // Actually, Node's `crypto.diffieHellman` works with `ec` keys.

        // CRITICAL FIX: We cannot sign with an ECDH key in Web Crypto.
        // For the sake of this strict refactor and keeping it working with the existing logic concepts:
        // We will simulate the signature for now or we must reuse the Identity Key as an ECDSA key (which is technically complex in WebCrypto due to strict typing).
        // 
        // HOWEVER, `server/db.ts` stores `identityKeyPublic` as a string.
        // The server verification logic (if any exists) would fail if we change the key type.
        // Looking at server code: `getUserKeyBundle` just returns strings. `X3DH` logic on server *was* doing `crypto.diffieHellman`.
        // There is NO signature verification logic in the provided server code snippets! 
        // The `signedPreKeySignature` is generated but never verified in the snippet I saw.
        // Let's verify `server/keyManagement.ts` again... 
        // It creates `signedPreKeySignature: signedPreKey.signature.toString('base64')`
        // But `SignedPreKeyGenerator.generate` in `server` uses `crypto.sign`.

        // Since we are moving logic to client, and the Server DOES NOT verify signatures (it just stores them),
        // and the Receiving Client will now be the one verifying (if we implement it),
        // we have a choice:
        // 1. Correctly implement ECDSA for Identity Keys (requires separate signing key or cross-import).
        // 2. For now, since we want "logic working" parity, we can create a dummy signature OR import the key as ECDSA just for signing.

        // Let's try to import the Identity Private Key as ECDSA-P-256 for signing.
        // This works if the curve is the same.

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
