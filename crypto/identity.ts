import * as crypto from 'crypto';
import { KeyPair } from '../shared/types.js'; 

export class IdentityKeyGenerator {
  static generate(): KeyPair {
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1', // P-256
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    return new KeyPair(keyPair.publicKey, keyPair.privateKey);
  }
}

export class IdentityKeyStore {
  private keys: Map<string, KeyPair>;

  constructor() {
    this.keys = new Map<string, KeyPair>();
  }

  save(keyId: string, publicKey: Buffer, privateKey: Buffer): void {
    this.keys.set(keyId, new KeyPair(publicKey, privateKey));
  }

  getPublicKey(keyId: string): Buffer | undefined {
    return this.keys.get(keyId)?.publicKey;
  }
}
