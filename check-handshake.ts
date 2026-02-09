
import { IdentityKeyGenerator } from './crypto/identity.js';
import { SignedPreKeyGenerator } from './crypto/signed-prekey.js';
import { X3DH } from './crypto/X3DH.js';
import { DoubleRatchet } from './crypto/ratchet.js';
import { KeyBundle } from './shared/types.js';
import { CryptoUtils } from './crypto/crypto-utils.js';

async function testHandshake() {
    console.log('--- Starting X3DH + Double Ratchet Test ---');

    try {
        // 1. Setup Alice (Sender)
        console.log('Generating Alice keys...');
        const aliceIdentity = await IdentityKeyGenerator.generate();
        const aliceEphemeral = await IdentityKeyGenerator.generate(); // Emulating ephemeral generation

        // 2. Setup Bob (Recipient)
        console.log('Generating Bob keys...');
        const bobIdentity = await IdentityKeyGenerator.generate();
        const bobSignedPreKey = await SignedPreKeyGenerator.generate(1, bobIdentity.privateKey);
        // Bob has no OPK for this test, or we can add one. Let's do with OPK to be thorough.
        const bobOpkPair = await IdentityKeyGenerator.generate();

        const bobBundle = new KeyBundle(
            bobIdentity.publicKey,
            bobSignedPreKey.publicKey,
            bobSignedPreKey.signature,
            [bobOpkPair.publicKey] // Just one for test
        );

        // 3. Alice performs X3DH (Sender)
        console.log('Alice performing X3DH...');
        const aliceSharedSecret = await X3DH.deriveSharedSecret(
            aliceIdentity.privateKey,
            aliceEphemeral.privateKey,
            bobBundle,
            bobOpkPair.publicKey // Alice decides to use this OPK
        );
        console.log('Alice Secret:', Buffer.from(aliceSharedSecret).toString('hex').slice(0, 32) + '...');

        // 4. Bob performs X3DH (Receiver)
        console.log('Bob performing X3DH (Restore)...');
        const bobSharedSecret = await X3DH.restoreSharedSecret(
            bobIdentity.privateKey,
            bobSignedPreKey.privateKey,
            aliceIdentity.publicKey,
            aliceEphemeral.publicKey,
            bobOpkPair.privateKey
        );
        console.log('Bob Secret:  ', Buffer.from(bobSharedSecret).toString('hex').slice(0, 32) + '...');

        // 5. Verify Secrets Match
        const secretsMatch = Buffer.from(aliceSharedSecret).equals(Buffer.from(bobSharedSecret));
        if (!secretsMatch) {
            console.error('❌ SHARED SECRETS DO NOT MATCH!');
            process.exit(1);
        }
        console.log('✅ Shared Secrets Match!');

        // 6. Init Ratchet
        console.log('Initializing Double Ratchets...');
        const aliceRatchet = await DoubleRatchet.init(aliceSharedSecret);
        const bobRatchet = await DoubleRatchet.init(bobSharedSecret);

        // 7. Alice Sends Message to Bob
        console.log('Alice sending message...');
        const msg1Key = await aliceRatchet.getNextMessageKey();
        // In real app, we encrypt payload with this key.
        console.log('Alice Message Key 1:', Buffer.from(msg1Key).toString('hex'));

        const bobMsg1Key = await bobRatchet.getNextMessageKey();
        console.log('Bob Message Key 1:  ', Buffer.from(bobMsg1Key).toString('hex'));

        if (Buffer.from(msg1Key).equals(Buffer.from(bobMsg1Key))) {
            console.log('✅ Message Keys Match!');
        } else {
            console.error('❌ MESSAGE KEYS DO NOT MATCH!');
            process.exit(1);
        }
    } catch (err) {
        console.error('Test failed with error:', err);
        process.exit(1);
    }
}

testHandshake();
