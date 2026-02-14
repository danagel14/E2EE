import { IdentityKeyGenerator } from './identity';
import { SignedPreKeyGenerator, OneTimePreKeyGenerator } from './prekey';


const STORAGE_PREFIX = 'e2ee_';

export interface UserKeys {
    userId: string;
    identityKey: { pub: string; priv: string }; // Base64
    signedPreKey: { id: number; pub: string; priv: string; sig: string };
    oneTimePreKeys: { id: number; pub: string; priv: string }[];
}

export class KeyManager {
    static async generateAndSaveKeys(userId: string): Promise<UserKeys | null> {
        // Check if keys already exist
        const storageKey = `${STORAGE_PREFIX}${userId}`;
        const existing = localStorage.getItem(storageKey);
        if (existing) {
            console.log('Keys found in storage for', userId);
            try {
                return JSON.parse(existing);
            } catch (e) {
                console.error('Invalid key storage, regenerating...');
            }
        }

        console.log('Generating new keys for', userId);

        // 1. Identity Key
        const ik = await IdentityKeyGenerator.generate();

        if (!ik.publicKeyBase64 || !ik.privateKeyBase64) throw new Error("Failed to export Identity Key");

        // 2. Signed PreKey
        const spkId = 1;
        const spk = await SignedPreKeyGenerator.generate(spkId, ik.privateKey);

        if (!spk.keyPair.publicKeyBase64 || !spk.keyPair.privateKeyBase64) throw new Error("Failed to export SPK");

        // 3. One-Time PreKeys (Batch of 20 for demo)
        const opks = await OneTimePreKeyGenerator.generateBatch(20);

        const opkStorage = opks.map(k => ({
            id: k.keyId,
            pub: k.keyPair.publicKeyBase64!,
            priv: k.keyPair.privateKeyBase64!
        }));

        const keys: UserKeys = {
            userId,
            identityKey: {
                pub: ik.publicKeyBase64,
                priv: ik.privateKeyBase64
            },
            signedPreKey: {
                id: spk.keyId,
                pub: spk.keyPair.publicKeyBase64,
                priv: spk.keyPair.privateKeyBase64,
                sig: spk.signature
            },
            oneTimePreKeys: opkStorage
        };

        // Save to localStorage (Private keys are here!)
        localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(keys));

        return keys;
    }

    static getKeys(userId: string): UserKeys | null {
        const data = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
        return data ? JSON.parse(data) : null;
    }

    // Helper to get only Public Parts for Server Registration
    static getPublicBundle(keys: UserKeys) {
        return {
            userId: keys.userId,
            identityKeyPublic: keys.identityKey.pub,
            signedPreKeyId: keys.signedPreKey.id,
            signedPreKeyPublic: keys.signedPreKey.pub,
            signedPreKeySignature: keys.signedPreKey.sig,
            oneTimePreKeys: keys.oneTimePreKeys.map(k => ({
                keyId: k.id,
                publicKey: k.pub
            }))
        };
    }
}