import crypto from 'crypto';

export class SignedPreKeyGenerator {
  static generate(keyId: number, identityPrivateKey: Buffer) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    // המרת Buffer ל-KeyObject לצורך חתימה
    const privateKeyObject = crypto.createPrivateKey({
      key: identityPrivateKey,
      format: 'der',
      type: 'pkcs8'
    });

    const sign = crypto.createSign('SHA256');
    sign.update(publicKey);
    sign.end();
    const signature = sign.sign(privateKeyObject);

    return {
      keyId,
      publicKey,
      privateKey,
      signature
    };
  }
}
