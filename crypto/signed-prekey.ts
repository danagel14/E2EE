import crypto from 'crypto';

export class SignedPreKeyGenerator {
  static generate(keyId: number, identityPrivateKey: Buffer) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

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
