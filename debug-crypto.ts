
import { CryptoUtils } from './crypto/crypto-utils.js';

console.log('Checking crypto...');
try {
    const crypto = CryptoUtils.crypto;
    console.log('Crypto available:', !!crypto);
    console.log('Subtle available:', !!crypto.subtle);
} catch (e) {
    console.error('Crypto check failed:', e);
}
