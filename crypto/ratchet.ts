import crypto from 'crypto';

export class DoubleRatchet {
    private rootKey: Buffer;
    private chainKey: Buffer;

    constructor(sharedSecret: Buffer) {
        this.rootKey = sharedSecret;
        this.chainKey = crypto.createHmac('sha256', this.rootKey).update('chain-salt').digest();
    }

    getNextMessageKey() {
        
        const messageKey = crypto.createHmac('sha256', this.chainKey).update('message-key').digest();
        this.chainKey = crypto.createHmac('sha256', this.chainKey).update('next-chain-key').digest();

        return messageKey;
    }
}