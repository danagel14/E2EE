import crypto from 'crypto';
import { KeyBundle } from '../shared/types.js'; 

export class X3DH {
  
  static deriveSharedSecret(
    senderIdentityPriv: Buffer,
    senderEphemeralPriv: Buffer,
    recipientBundle: KeyBundle
  ): Buffer {
    
    // כאן אנחנו הופכים את ה-Buffer ל-KeyObject
    // זה מה ש-TypeScript דורש כדי להשתיק את השגיאה
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

    // כעת הפונקציה מקבלת אובייקטים מתאימים ולא Buffer גולמי
    const dh1 = crypto.diffieHellman({
      privateKey: toPrivKey(senderIdentityPriv),
      publicKey: toPubKey(recipientBundle.signedPreKey)
    });

    const dh2 = crypto.diffieHellman({
      privateKey: toPrivKey(senderEphemeralPriv),
      publicKey: toPubKey(recipientBundle.identityKey)
    });

    const dh3 = crypto.diffieHellman({
      privateKey: toPrivKey(senderEphemeralPriv),
      publicKey: toPubKey(recipientBundle.signedPreKey)
    });

    const combinedSecret = Buffer.concat([dh1, dh2, dh3]);

    return crypto.createHash('sha256').update(combinedSecret).digest();
  }
}