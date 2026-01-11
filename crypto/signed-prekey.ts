import crypto from 'crypto';

export class SignedPreKeyGenerator {
  static generate(keyId: number, identityPrivateKey: Buffer) {
    // 1. יצירת זוג מפתחות אליפטיים (P-256)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    // 2. חתימה על המפתח הציבורי החדש בעזרת המפתח הפרטי הקבוע שלך
    const sign = crypto.createSign('SHA256');
    sign.update(publicKey);
    sign.end();
    const signature = sign.sign(identityPrivateKey);

    return {
      keyId,
      publicKey,
      privateKey,
      signature
    };
  }
}
