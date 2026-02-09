
import { KeyPair } from '../shared/types.js';
import { CryptoUtils } from './crypto-utils.js';

export class IdentityKeyGenerator {
  static async generate(): Promise<KeyPair> {
    const keyPair = await CryptoUtils.generateKeyPair();

    // Export keys to SPKI/PKCS8 Buffers (to match existing types)
    const publicKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    return new KeyPair(new Uint8Array(publicKeyBuffer), new Uint8Array(privateKeyBuffer));
  }
}

export class IdentityKeyStore {
  private keys: Map<string, KeyPair>;

  constructor() {
    this.keys = new Map<string, KeyPair>();
  }

  save(keyId: string, publicKey: Uint8Array, privateKey: Uint8Array): void {
    this.keys.set(keyId, new KeyPair(publicKey, privateKey));
  }

  getPublicKey(keyId: string): Uint8Array | undefined {
    return this.keys.get(keyId)?.publicKey;
  }
}
