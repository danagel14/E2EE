
import { CryptoUtils } from './crypto-utils.js';

export interface OneTimePreKey {
  keyId: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export class OneTimePreKeyGenerator {
  static async generateBatch(startId: number = 0, count: number = 100): Promise<OneTimePreKey[]> {
    const promises = [];

    for (let i = 0; i < count; i++) {
      promises.push((async () => {
        const keyPair = await CryptoUtils.generateKeyPair();
        const publicKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const privateKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

        return {
          keyId: startId + i,
          publicKey: new Uint8Array(publicKeyBuffer),
          privateKey: new Uint8Array(privateKeyBuffer)
        };
      })());
    }

    return Promise.all(promises);
  }
}