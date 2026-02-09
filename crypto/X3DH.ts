
import { KeyBundle } from '../shared/types.js';
import { CryptoUtils } from './crypto-utils.js';

export class X3DH {

  /**
   * Sender Side: Derive Shared Secret
   * 
   * @param senderIdentityPriv - Sender's Identity Private Key (Buffer/Uint8Array)
   * @param senderEphemeralPriv - Sender's Ephemeral Private Key (Buffer/Uint8Array)
   * @param recipientBundle - Recipient's Key Bundle (Identity, Signed PreKey, One-Time PreKey)
   * @param oneTimePreKey - Optional One-Time PreKey Public Key (Buffer/Uint8Array)
   */
  static async deriveSharedSecret(
    senderIdentityPriv: BufferSource,
    senderEphemeralPriv: BufferSource,
    recipientBundle: KeyBundle,
    oneTimePreKey?: BufferSource
  ): Promise<Uint8Array> {

    // Import keys
    const senderIdentityKey = await CryptoUtils.importKey(senderIdentityPriv, 'private');
    const recipientSignedPreKey = await CryptoUtils.importKey(recipientBundle.signedPreKey as unknown as BufferSource, 'public');
    const senderEphemeralKey = await CryptoUtils.importKey(senderEphemeralPriv, 'private');
    const recipientIdentityKey = await CryptoUtils.importKey(recipientBundle.identityKey as unknown as BufferSource, 'public');

    // DH1: IKa || SPKb
    const dh1 = await CryptoUtils.deriveSharedSecret(senderIdentityKey, recipientSignedPreKey);

    // DH2: EKa || IKb
    const dh2 = await CryptoUtils.deriveSharedSecret(senderEphemeralKey, recipientIdentityKey);

    // DH3: EKa || SPKb
    const dh3 = await CryptoUtils.deriveSharedSecret(senderEphemeralKey, recipientSignedPreKey);

    let combinedSecret: Uint8Array;

    if (oneTimePreKey) {
      const recipientOneTimePreKey = await CryptoUtils.importKey(oneTimePreKey, 'public');
      // DH4: EKa || OPKb
      const dh4 = await CryptoUtils.deriveSharedSecret(senderEphemeralKey, recipientOneTimePreKey);

      combinedSecret = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength + dh4.byteLength);
      combinedSecret.set(new Uint8Array(dh1), 0);
      combinedSecret.set(new Uint8Array(dh2), dh1.byteLength);
      combinedSecret.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);
      combinedSecret.set(new Uint8Array(dh4), dh1.byteLength + dh2.byteLength + dh3.byteLength);

      console.log('X3DH (Sender): Using One-Time Prekey (DH4)');
    } else {
      combinedSecret = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength);
      combinedSecret.set(new Uint8Array(dh1), 0);
      combinedSecret.set(new Uint8Array(dh2), dh1.byteLength);
      combinedSecret.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

      console.log('X3DH (Sender): No One-Time Prekey available, using 3-DH only');
    }

    // KDF (SHA-256)
    // We can use HKDF or just a simple Hash as in the original code. 
    // Original code used createHash('sha256').update(combinedSecret).digest()
    // To match original behavior (SHA256 hash of concat secrets):
    const digest = await CryptoUtils.crypto.subtle.digest('SHA-256', combinedSecret as unknown as BufferSource);
    return new Uint8Array(digest);
  }

  /**
   * Receiver Side: Restore Shared Secret
   * 
   * @param recipientIdentityPriv - Recipient's Identity Private Key
   * @param recipientSignedPreKeyPriv - Recipient's Signed PreKey Private Key
   * @param recipientOneTimePreKeyPriv - Recipient's One-Time PreKey Private Key (Optional)
   * @param senderIdentityKeyPub - Sender's Identity Public Key
   * @param senderEphemeralKeyPub - Sender's Ephemeral Public Key
   */
  static async restoreSharedSecret(
    recipientIdentityPriv: BufferSource,
    recipientSignedPreKeyPriv: BufferSource,
    senderIdentityKeyPub: BufferSource,
    senderEphemeralKeyPub: BufferSource,
    recipientOneTimePreKeyPriv?: BufferSource
  ): Promise<Uint8Array> {

    // Import keys
    const recipIdentityKey = await CryptoUtils.importKey(recipientIdentityPriv, 'private');
    const recipSignedPreKey = await CryptoUtils.importKey(recipientSignedPreKeyPriv, 'private');
    const sendIdentityKey = await CryptoUtils.importKey(senderIdentityKeyPub, 'public');
    const sendEphemeralKey = await CryptoUtils.importKey(senderEphemeralKeyPub, 'public');

    // DH1: IKa || SPKb  => Sender Identity || Recipient Signed PreKey (Private)
    // Note: ECDH is commutative. derive(PrivA, PubB) == derive(PrivB, PubA)
    // Here: derive(RecipSignedPreKeyPriv, SenderIdentityPub) matches DH1
    const dh1 = await CryptoUtils.deriveSharedSecret(recipSignedPreKey, sendIdentityKey);

    // DH2: EKa || IKb => Sender Ephemeral || Recipient Identity (Private)
    // Here: derive(RecipIdentityPriv, SenderEphemeralPub) matches DH2
    const dh2 = await CryptoUtils.deriveSharedSecret(recipIdentityKey, sendEphemeralKey);

    // DH3: EKa || SPKb => Sender Ephemeral || Recipient Signed PreKey (Private)
    // Here: derive(RecipSignedPreKeyPriv, SenderEphemeralPub) matches DH3
    const dh3 = await CryptoUtils.deriveSharedSecret(recipSignedPreKey, sendEphemeralKey);

    let combinedSecret: Uint8Array;

    if (recipientOneTimePreKeyPriv) {
      const recipOneTimePreKey = await CryptoUtils.importKey(recipientOneTimePreKeyPriv, 'private');
      // DH4: EKa || OPKb => Sender Ephemeral || Recipient One-Time PreKey (Private)
      const dh4 = await CryptoUtils.deriveSharedSecret(recipOneTimePreKey, sendEphemeralKey);

      combinedSecret = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength + dh4.byteLength);
      combinedSecret.set(new Uint8Array(dh1), 0);
      combinedSecret.set(new Uint8Array(dh2), dh1.byteLength);
      combinedSecret.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);
      combinedSecret.set(new Uint8Array(dh4), dh1.byteLength + dh2.byteLength + dh3.byteLength);

      console.log('X3DH (Receiver): Using One-Time Prekey (DH4)');
    } else {
      combinedSecret = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength);
      combinedSecret.set(new Uint8Array(dh1), 0);
      combinedSecret.set(new Uint8Array(dh2), dh1.byteLength);
      combinedSecret.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

      console.log('X3DH (Receiver): No One-Time Prekey available, using 3-DH only');
    }

    // KDF (SHA-256)
    const digest = await CryptoUtils.crypto.subtle.digest('SHA-256', combinedSecret as unknown as BufferSource);
    return new Uint8Array(digest);
  }
}