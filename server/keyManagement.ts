import { IdentityKeyGenerator } from '../crypto/identity.js';
import { SignedPreKeyGenerator } from '../crypto/signed-prekey.js';
import { OneTimePreKeyGenerator } from '../crypto/optk.js';
import { UserModel } from './db.js';

// generate keys for new user
export async function generateUserKeys(userId: string) {
    // 1. Generate Identity Key (IK) - long term key
    const identityKeyPair = IdentityKeyGenerator.generate();

    // 2. Generate Signed Pre Key (SPK) - intermediate term key
    const signedPreKey = SignedPreKeyGenerator.generate(1, identityKeyPair.privateKey);

    // 3. Generate One-Time Pre Keys (OPK) - short term keys
    const oneTimePreKeys = OneTimePreKeyGenerator.generateBatch(100);

    // Save to DB
    const user = await UserModel.findOneAndUpdate(
        { userId },
        {
            userId,
            identityKeyPublic: identityKeyPair.publicKey.toString('base64'),
            signedPreKeyId: signedPreKey.keyId,
            signedPreKeyPublic: signedPreKey.publicKey.toString('base64'),
            signedPreKeySignature: signedPreKey.signature.toString('base64'),
            oneTimePreKeys: oneTimePreKeys.map(opk => ({
                keyId: opk.keyId,
                publicKey: opk.publicKey.toString('base64'),
                used: false
            }))
        },
        { upsert: true, new: true }
    );

    console.log(`Generated keys for user ${userId}: IK, SPK, ${oneTimePreKeys.length} OPKs`);
    return user;
}

// Consume One-Time PreKey (Mark it as used)
export async function consumeOneTimePreKey(userId: string): Promise<{ keyId: number; publicKey: string } | null> {
    const user = await UserModel.findOne({ userId });
    if (!user) return null;

    // Find first available OPK
    const availableKey = user.oneTimePreKeys.find((key: any) => !key.used);
    if (!availableKey) {
        console.warn(`No available OPK for user ${userId}`);
        return null;
    }

    // Mark OPK as used
    await UserModel.updateOne(
        { userId, 'oneTimePreKeys.keyId': availableKey.keyId },
        { $set: { 'oneTimePreKeys.$.used': true } }
    );

    console.log(`Consumed OPK ${availableKey.keyId} for user ${userId}`);

    return {
        keyId: availableKey.keyId,
        publicKey: availableKey.publicKey,
    };
}

// Add new OPKs when stock runs out
export async function replenishOneTimePreKeys(userId: string, count: number = 50) {
    const user = await UserModel.findOne({ userId });
    if (!user) return;

    const unusedCount = user.oneTimePreKeys.filter((key: any) => !key.used).length;

    if (unusedCount < 10) {
        const newKeys = OneTimePreKeyGenerator.generateBatch(count);
        const maxKeyId = Math.max(...user.oneTimePreKeys.map((k: any) => k.keyId), 0);

        const newOPKs = newKeys.map((opk, index) => ({
            keyId: maxKeyId + index + 1,
            publicKey: opk.publicKey.toString('base64'),
            used: false
        }));

        await UserModel.updateOne(
            { userId },
            { $push: { oneTimePreKeys: { $each: newOPKs } } }
        );

        console.log(`Replenished ${count} OPKs for user ${userId}`);
    }
}

// Get Key Bundle for user (for X3DH)
export async function getUserKeyBundle(userId: string) {
    const user = await UserModel.findOne({ userId });
    if (!user) return null;

    // Find first available OPK
    const availableOPK = user.oneTimePreKeys.find((key: any) => !key.used);

    return {
        userId: user.userId,
        identityKey: user.identityKeyPublic,
        signedPreKey: user.signedPreKeyPublic,
        signedPreKeySignature: user.signedPreKeySignature,
        oneTimePreKey: availableOPK ? availableOPK.publicKey : null,
        oneTimePreKeyId: availableOPK ? availableOPK.keyId : null
    };
}