import crypto from 'crypto';
export class OneTimePreKeyGenerator {
  static generateBatch(count: number = 100) {
    const keys = [];

    for (let i = 0; i < count; i++) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' }
      });

      keys.push({
        keyId: i,
        publicKey,
        privateKey
      });
    }

    return keys;
  }
}