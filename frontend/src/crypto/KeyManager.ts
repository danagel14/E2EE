
import { IdentityKeyGenerator } from '@crypto/identity';
import { SignedPreKeyGenerator } from '@crypto/signed-prekey';
import { OneTimePreKeyGenerator } from '@crypto/optk';
import { CryptoUtils } from '@crypto/crypto-utils';
import { KeyPair } from '@shared/types';

const STORAGE_KEY_PREFIX = 'e2ee_keys_';

export class KeyManager {
    private userId: string;

    constructor(userId: string) {
        this.userId = userId;
    }

    private getStorageKey(key: string) {
        return `${STORAGE_KEY_PREFIX}${this.userId}_${key}`;
    }

    // Generate and store all keys if they don't exist
    async ensureKeysExist(): Promise<boolean> {
        const existingIdentity = localStorage.getItem(this.getStorageKey('identityPrivate'));
        if (existingIdentity) {
            console.log('Keys already exist for user', this.userId);
            return true;
        }

        console.log('Generating new keys for user', this.userId);

        // 1. Identity Key
        const identityKey = await IdentityKeyGenerator.generate();
        this.saveKeyPair('identity', identityKey);

        // 2. Signed Pre Key
        const signedPreKey = await SignedPreKeyGenerator.generate(1, identityKey.privateKey);
        this.saveSignedPreKey(signedPreKey);

        // 3. One-Time Pre Keys
        const oneTimePreKeys = await OneTimePreKeyGenerator.generateBatch(0, 100);
        this.saveOneTimePreKeys(oneTimePreKeys);

        return false; // Keys were just generated
    }

    // Load keys from storage into memory/helper structures
    async loadKeys() {
        // In a real implementation, we'd load keys into the store
        // For now, we trust localStorage has them
    }

    // Get the Public Key Bundle to send to the server
    getPublicKeyBundle() {
        const identityPubContext = localStorage.getItem(this.getStorageKey('identityPublic'));
        const signedPreKeyPubContext = localStorage.getItem(this.getStorageKey('signedPreKeyPublic'));
        const signedPreKeySigContext = localStorage.getItem(this.getStorageKey('signedPreKeySignature'));
        const opkListContext = localStorage.getItem(this.getStorageKey('oneTimePreKeys'));

        if (!identityPubContext || !signedPreKeyPubContext || !signedPreKeySigContext || !opkListContext) {
            throw new Error('Missing keys in storage');
        }

        const opks = JSON.parse(opkListContext);

        // Convert OPKs to format expected by server (Base64 strings for public keys)
        // Server expects: { keyId, publicKey (base64) }
        const opkBundle = opks.map((opk: any) => ({
            keyId: opk.keyId,
            publicKey: opk.publicKey // Already stored as Base64 string in saveOneTimePreKeys
        }));

        return {
            userId: this.userId,
            identityKeyPublic: identityPubContext, // Base64
            signedPreKeyId: 1, // Fixed for now
            signedPreKeyPublic: signedPreKeyPubContext, // Base64
            signedPreKeySignature: signedPreKeySigContext, // Base64
            oneTimePreKeys: opkBundle
        };
    }

    // Helpers to save keys (converting to Base64 for storage)
    private saveKeyPair(type: string, keyPair: KeyPair) {
        localStorage.setItem(this.getStorageKey(`${type}Public`), CryptoUtils.toBase64(keyPair.publicKey));
        localStorage.setItem(this.getStorageKey(`${type}Private`), CryptoUtils.toBase64(keyPair.privateKey));
    }

    private saveSignedPreKey(spk: any) {
        localStorage.setItem(this.getStorageKey('signedPreKeyId'), spk.keyId.toString());
        localStorage.setItem(this.getStorageKey('signedPreKeyPublic'), CryptoUtils.toBase64(spk.publicKey));
        localStorage.setItem(this.getStorageKey('signedPreKeyPrivate'), CryptoUtils.toBase64(spk.privateKey));
        localStorage.setItem(this.getStorageKey('signedPreKeySignature'), CryptoUtils.toBase64(spk.signature));
    }

    private saveOneTimePreKeys(opks: any[]) {
        // Store as JSON of Base64 strings
        const serialized = opks.map(opk => ({
            keyId: opk.keyId,
            publicKey: CryptoUtils.toBase64(opk.publicKey),
            privateKey: CryptoUtils.toBase64(opk.privateKey)
        }));
        localStorage.setItem(this.getStorageKey('oneTimePreKeys'), JSON.stringify(serialized));
    }

    // Method to retrieve private keys for decryption/handshake
    getPrivateKey(type: 'identity' | 'signedPreKey' | 'oneTimePreKey', keyId?: number): Uint8Array {
        if (type === 'identity') {
            const b64 = localStorage.getItem(this.getStorageKey('identityPrivate'));
            if (!b64) throw new Error('Identity private key not found');
            return CryptoUtils.fromBase64(b64);
        }
        if (type === 'signedPreKey') {
            const b64 = localStorage.getItem(this.getStorageKey('signedPreKeyPrivate'));
            if (!b64) throw new Error('Signed PreKey private key not found');
            return CryptoUtils.fromBase64(b64);
        }
        if (type === 'oneTimePreKey') {
            if (keyId === undefined) throw new Error('Key ID required for OPK');
            const opksJson = localStorage.getItem(this.getStorageKey('oneTimePreKeys'));
            if (!opksJson) throw new Error('No OPKs found');
            const opks = JSON.parse(opksJson);
            const key = opks.find((k: any) => k.keyId === keyId);
            if (!key) {
                // It might be consumed already or deleted. 
                // In a real app we keep used keys for a bit or handle this better.
                throw new Error(`OPK ${keyId} not found`);
            }
            return CryptoUtils.fromBase64(key.privateKey);
        }
        throw new Error('Unknown key type');
    }

    getPublicKey(type: 'identity'): Uint8Array {
        if (type === 'identity') {
            const b64 = localStorage.getItem(this.getStorageKey('identityPublic'));
            if (!b64) throw new Error('Identity public key not found');
            return CryptoUtils.fromBase64(b64);
        }
        throw new Error('Not implemented for other public keys');
    }
}
