
import { CryptoUtils } from './crypto-utils.js';

export class SignedPreKeyGenerator {
  static async generate(keyId: number, identityPrivateKey: Uint8Array) {
    // Generate new key pair for the Signed PreKey
    const keyPair = await CryptoUtils.generateKeyPair();

    // Import Identity Private Key to sign with
    const signingKey = await CryptoUtils.importKey(
      identityPrivateKey as unknown as BufferSource,
      'private',
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      }
    );

    // Export public key to sign it
    const publicKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyBuffer = await CryptoUtils.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    // Sign the public key
    // In Original Node code: sign.update(publicKey)
    const signature = await CryptoUtils.crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      signingKey,
      publicKeyBuffer
    );

    return {
      keyId,
      publicKey: new Uint8Array(publicKeyBuffer),
      privateKey: new Uint8Array(privateKeyBuffer),
      signature: new Uint8Array(signature)
    };
  }
}
