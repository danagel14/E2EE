
import { CryptoUtils } from './crypto-utils.js';

export class DoubleRatchet {
    private chainKey: Uint8Array;

    private constructor(_rootKey: Uint8Array, chainKey: Uint8Array) {
        // rootKey would be used in a full Double Ratchet implementation for key ratcheting
        // For this simplified version, we only use chainKey
        this.chainKey = chainKey;
    }

    static async init(sharedSecret: Uint8Array): Promise<DoubleRatchet> {
        // Initial Chain Key derivation
        // KDF(RK, "chain-salt") -> CK
        // We use HKDF or HMAC as KDF. Original code used HMAC.
        // chainKey = hmac(rootKey, 'chain-salt')
        const chainSalt = CryptoUtils.toUint8Array('chain-salt');
        const chainKeyBuffer = await CryptoUtils.hmacSha256(
            sharedSecret as unknown as BufferSource,
            chainSalt as unknown as BufferSource
        );

        return new DoubleRatchet(sharedSecret, new Uint8Array(chainKeyBuffer));
    }

    async getNextMessageKey(): Promise<Uint8Array> {
        // MK = HMAC(CK, "message-key")
        // NextCK = HMAC(CK, "next-chain-key")

        const messageKeyInput = CryptoUtils.toUint8Array('message-key');
        const nextChainKeyInput = CryptoUtils.toUint8Array('next-chain-key');

        const messageKeyBuffer = await CryptoUtils.hmacSha256(
            this.chainKey as unknown as BufferSource,
            messageKeyInput as unknown as BufferSource
        );
        const nextChainKeyBuffer = await CryptoUtils.hmacSha256(
            this.chainKey as unknown as BufferSource,
            nextChainKeyInput as unknown as BufferSource
        );

        this.chainKey = new Uint8Array(nextChainKeyBuffer);

        return new Uint8Array(messageKeyBuffer);
    }
}