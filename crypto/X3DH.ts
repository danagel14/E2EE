import crypto from 'crypto';
import { KeyBundle } from '../shared/types.js';

export class X3DH {

  static deriveSharedSecret(
    senderIdentityPriv: Buffer,
    senderEphemeralPriv: Buffer,
    recipientBundle: KeyBundle,
    oneTimePreKey?: Buffer  // Optional OPK for DH4
  ): Buffer {


    const toPrivKey = (buf: Buffer) => crypto.createPrivateKey({
      key: buf,
      format: 'der',
      type: 'pkcs8'
    });

    const toPubKey = (buf: Buffer) => crypto.createPublicKey({
      key: buf,
      format: 'der',
      type: 'spki'
    });

    // DH1: IKa || SPKb
    const dh1 = crypto.diffieHellman({
      privateKey: toPrivKey(senderIdentityPriv),
      publicKey: toPubKey(recipientBundle.signedPreKey)
    });

    // DH2: EKa || IKb
    const dh2 = crypto.diffieHellman({
      privateKey: toPrivKey(senderEphemeralPriv),
      publicKey: toPubKey(recipientBundle.identityKey)
    });

    // DH3: EKa || SPKb
    const dh3 = crypto.diffieHellman({
      privateKey: toPrivKey(senderEphemeralPriv),
      publicKey: toPubKey(recipientBundle.signedPreKey)
    });

    // DH4: EKa || OPKb (if available - provides forward secrecy)
    let combinedSecret = Buffer.concat([dh1, dh2, dh3]);

    if (oneTimePreKey) {
      const dh4 = crypto.diffieHellman({
        privateKey: toPrivKey(senderEphemeralPriv),
        publicKey: toPubKey(oneTimePreKey)
      });
      combinedSecret = Buffer.concat([combinedSecret, dh4]);
      console.log('X3DH: Using One-Time Prekey (DH4) for enhanced forward secrecy');
    } else {
      console.log('X3DH: No One-Time Prekey available, using 3-DH only');
    }

    return crypto.createHash('sha256').update(combinedSecret).digest();
  }
}