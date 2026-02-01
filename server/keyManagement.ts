import { IdentityKeyGenerator } from '../crypto/identity.js';
import { SignedPreKeyGenerator } from '../crypto/signed-prekey.js';
import { OneTimePreKeyGenerator } from '../crypto/optk.js';
import { UserModel } from './db.js';

/**
 * יצירת כל המפתחות הקריפטוגרפיים למשתמש חדש
 */
export async function generateUserKeys(userId: string) {
    // 1. יצירת Identity Key (IK) - מפתח ארוך טווח
    const identityKeyPair = IdentityKeyGenerator.generate();

    // 2. יצירת Signed Pre Key (SPK) - מפתח בינוני טווח
    const signedPreKey = SignedPreKeyGenerator.generate(1, identityKeyPair.privateKey);

    // 3. יצירת One-Time Pre Keys (OPK) - מפתחות חד פעמיים
    const oneTimePreKeys = OneTimePreKeyGenerator.generateBatch(100);

    // שמירה ב-DB
    const user = await UserModel.findOneAndUpdate(
        { userId },
        {
            userId,
            identityKeyPublic: identityKeyPair.publicKey.toString('base64'),
            identityKeyPrivate: identityKeyPair.privateKey.toString('base64'),
            signedPreKeyId: signedPreKey.keyId,
            signedPreKeyPublic: signedPreKey.publicKey.toString('base64'),
            signedPreKeyPrivate: signedPreKey.privateKey.toString('base64'),
            signedPreKeySignature: signedPreKey.signature.toString('base64'),
            oneTimePreKeys: oneTimePreKeys.map(opk => ({
                keyId: opk.keyId,
                publicKey: opk.publicKey.toString('base64'),
                privateKey: opk.privateKey.toString('base64'),
                used: false
            }))
        },
        { upsert: true, new: true }
    );

    console.log(`Generated keys for user ${userId}: IK, SPK, ${oneTimePreKeys.length} OPKs`);
    return user;
}

/**
 * שימוש ב-One-Time PreKey (מסמן אותו כמשומש)
 */
export async function consumeOneTimePreKey(userId: string): Promise<{ keyId: number; publicKey: string; privateKey: string } | null> {
    const user = await UserModel.findOne({ userId });
    if (!user) return null;

    // מציאת OPK ראשון שלא משומש
    const availableKey = user.oneTimePreKeys.find((key: any) => !key.used);
    if (!availableKey) {
        console.warn(`No available OPK for user ${userId}`);
        return null;
    }

    // סימון המפתח כמשומש
    await UserModel.updateOne(
        { userId, 'oneTimePreKeys.keyId': availableKey.keyId },
        { $set: { 'oneTimePreKeys.$.used': true } }
    );

    console.log(`Consumed OPK ${availableKey.keyId} for user ${userId}`);

    return {
        keyId: availableKey.keyId,
        publicKey: availableKey.publicKey,
        privateKey: availableKey.privateKey
    };
}

/**
 * הוספת OPK חדשים כשהמלאי נגמר
 */
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
            privateKey: opk.privateKey.toString('base64'),
            used: false
        }));

        await UserModel.updateOne(
            { userId },
            { $push: { oneTimePreKeys: { $each: newOPKs } } }
        );

        console.log(`Replenished ${count} OPKs for user ${userId}`);
    }
}

/**
 * קבלת Key Bundle למשתמש (לשימוש ב-X3DH)
 */
export async function getUserKeyBundle(userId: string) {
    const user = await UserModel.findOne({ userId });
    if (!user) return null;

    // מציאת OPK זמין
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
