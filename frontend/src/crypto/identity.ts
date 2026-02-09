import { exportPublicKey, exportPrivateKey } from './web-crypto-utils';

export interface KeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    publicKeyBase64?: string;
    privateKeyBase64?: string;
}

export class IdentityKeyGenerator {
    static async generate(): Promise<KeyPair> {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256",
            },
            true, // whether the key is extractable (i.e. can be exported)
            ["deriveKey", "deriveBits"]
        ) as CryptoKeyPair;

        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            publicKeyBase64: await exportPublicKey(keyPair.publicKey),
            privateKeyBase64: await exportPrivateKey(keyPair.privateKey)
        };
    }
}
