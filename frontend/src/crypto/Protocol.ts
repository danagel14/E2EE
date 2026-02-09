
import { X3DH } from '@crypto/X3DH';
import { DoubleRatchet } from '@crypto/ratchet';
import { CryptoUtils } from '@crypto/crypto-utils';
import { KeyBundle } from '@shared/types';
import { KeyManager } from './KeyManager';

export class Protocol {
    private keyManager: KeyManager;
    private ratchets: Map<string, DoubleRatchet>; // key: "myId|peerId"

    constructor(keyManager: KeyManager) {
        this.keyManager = keyManager;
        this.ratchets = new Map();
    }

    private getRatchetKey(peerId: string, myId: string) {
        return [myId, peerId].sort().join('|');
    }

    // Check if we have an active session (ratchet) with peer
    hasSession(peerId: string, myId: string): boolean {
        return this.ratchets.has(this.getRatchetKey(peerId, myId));
    }

    // Initialize a session as SENDER (Alice)
    async initSessionAsSender(peerId: string, myId: string, serverUrl: string, socket: any): Promise<void> {
        if (this.hasSession(peerId, myId)) return;

        console.log(`Protocol: Initializing session with ${peerId}`);

        // 1. Fetch Peer's PreKey Bundle from Server
        const response = await fetch(`${serverUrl}/keys/${peerId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch keys for ${peerId}`);
        }
        const bundleData = await response.json();

        // Convert bundle data (Base64) to Uint8Array
        const peerBundle = new KeyBundle(
            CryptoUtils.fromBase64(bundleData.identityKey),
            CryptoUtils.fromBase64(bundleData.signedPreKey),
            CryptoUtils.fromBase64(bundleData.signedPreKeySignature),
            [] // OPK handled separately
        );
        const peerOpk = bundleData.oneTimePreKey ? CryptoUtils.fromBase64(bundleData.oneTimePreKey) : undefined;

        // 2. Perform X3DH
        const myIdentityPriv = this.keyManager.getPrivateKey('identity');

        // Generate Ephemeral Key
        const ephemeralKeyPair = await CryptoUtils.generateKeyPair();
        const ephemeralPriv = await CryptoUtils.crypto.subtle.exportKey('pkcs8', ephemeralKeyPair.privateKey);
        // We need to keep the public key to send to Bob
        const ephemeralPub = await CryptoUtils.crypto.subtle.exportKey('spki', ephemeralKeyPair.publicKey);

        const sharedSecret = await X3DH.deriveSharedSecret(
            myIdentityPriv as unknown as BufferSource,
            new Uint8Array(ephemeralPriv) as unknown as BufferSource,
            peerBundle,
            peerOpk as unknown as BufferSource | undefined
        );

        // 3. Initialize Ratchet
        const ratchet = await DoubleRatchet.init(sharedSecret);
        this.ratchets.set(this.getRatchetKey(peerId, myId), ratchet);

        // 4. Send "PreKey Message" (Initial message with headers)
        // We need to tell the server/recipient which keys we used.
        // In a real Signal implementation, this data is attached to the first encrypted message.
        // Here, we can emit an event to the server to forward the "session init" metadata to the peer.
        /*
            Metadata needed by Receiver:
            - Sender Identity Key (Public)
            - Sender Ephemeral Key (Public)
            - Used One-Time PreKey ID (if any)
        */

        const sessionMetadata = {
            to: peerId,
            from: myId,
            senderIdentityKey: CryptoUtils.toBase64(this.keyManager.getPublicKey('identity')),
            senderEphemeralKey: CryptoUtils.toBase64(new Uint8Array(ephemeralPub)),
            usedOneTimePreKeyId: bundleData.oneTimePreKeyId
        };

        // Send metadata via socket (or REST)
        await new Promise<void>((resolve, reject) => {
            socket.emit('establish-session-metadata', sessionMetadata, (ack: any) => {
                if (ack.ok) resolve();
                else reject(new Error(ack.error));
            });
        });

        console.log('Protocol: Session established (Sender side)');
    }

    // Handle incoming session request (Receiver side)
    async handleSessionRequest(data: any) {
        /*
          data: {
              from: string, // Sender ID
              senderIdentityKey: string (Base64),
              senderEphemeralKey: string (Base64),
              usedOneTimePreKeyId?: number
          }
        */
        const myId = data.to; // I am the receiver
        const peerId = data.from;

        console.log(`Protocol: Handling session request from ${peerId}`);

        const myIdentityPriv = this.keyManager.getPrivateKey('identity');
        const mySignedPreKeyPriv = this.keyManager.getPrivateKey('signedPreKey');

        let myOpkPriv: Uint8Array | undefined;
        if (data.usedOneTimePreKeyId) {
            myOpkPriv = this.keyManager.getPrivateKey('oneTimePreKey', data.usedOneTimePreKeyId);
        }

        const senderIdentityKey = CryptoUtils.fromBase64(data.senderIdentityKey);
        const senderEphemeralKey = CryptoUtils.fromBase64(data.senderEphemeralKey);

        const sharedSecret = await X3DH.restoreSharedSecret(
            myIdentityPriv as unknown as BufferSource,
            mySignedPreKeyPriv as unknown as BufferSource,
            senderIdentityKey as unknown as BufferSource,
            senderEphemeralKey as unknown as BufferSource,
            myOpkPriv as unknown as BufferSource | undefined
        );

        const ratchet = await DoubleRatchet.init(sharedSecret);
        this.ratchets.set(this.getRatchetKey(peerId, myId), ratchet);

        console.log('Protocol: Session established (Receiver side)');
    }

    async encryptMessage(peerId: string, myId: string, plaintext: string): Promise<string> {
        const ratchet = this.ratchets.get(this.getRatchetKey(peerId, myId));
        if (!ratchet) throw new Error('No session established');

        const messageKey = await ratchet.getNextMessageKey();

        // Encrypt plaintext with messageKey (AES-GCM)
        // Here we implement a simple encryption using CryptoUtils
        // IV should be unique. In signal, it's usually derived or sent.
        // For simplicity, we generate a random IV and prepend it.
        const iv = new Uint8Array(12); // 96-bit IV
        CryptoUtils.crypto.getRandomValues(iv);

        const plaintextBytes = CryptoUtils.toUint8Array(plaintext);
        const ciphertextBuffer = await CryptoUtils.encryptAesGcm(
            messageKey as unknown as BufferSource,
            iv as unknown as BufferSource,
            plaintextBytes as unknown as BufferSource
        );

        // Format: IV (Base64) . Ciphertext (Base64)
        return `${CryptoUtils.toBase64(iv)}.${CryptoUtils.toBase64(new Uint8Array(ciphertextBuffer))}`;
    }

    async decryptMessage(peerId: string, myId: string, ciphertextWhole: string): Promise<string> {
        const ratchet = this.ratchets.get(this.getRatchetKey(peerId, myId));
        if (!ratchet) throw new Error('No session established');

        const messageKey = await ratchet.getNextMessageKey();

        const [ivB64, ciphertextB64] = ciphertextWhole.split('.');
        const iv = CryptoUtils.fromBase64(ivB64);
        const ciphertext = CryptoUtils.fromBase64(ciphertextB64);

        try {
            const plaintextBuffer = await CryptoUtils.decryptAesGcm(
                messageKey as unknown as BufferSource,
                iv as unknown as BufferSource,
                ciphertext as unknown as BufferSource
            );
            return new TextDecoder().decode(plaintextBuffer);
        } catch (e) {
            console.error('Decryption failed', e);
            return '[Decryption Error]';
        }
    }
}
