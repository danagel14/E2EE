
export class CryptoUtils {
    static get crypto() {
        // In Node 19+ and modern browsers, globalThis.crypto is available.
        // In older Node environments, we might need to polyfill or use require('node:crypto').webcrypto
        if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
            return globalThis.crypto;
        }
        // Fallback for Node.js if globalThis.crypto is not set (shim)
        // However, since we are using ES modules and newer Node, we expect it to be there.
        // Ideally, we'd do: return require('node:crypto').webcrypto; but we are in ESM.
        throw new Error('Web Crypto API not available in this environment');
    }

    static async generateKeyPair(): Promise<CryptoKeyPair> {
        return await this.crypto.subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256',
            },
            true,
            ['deriveKey', 'deriveBits']
        );
    }

    static async importKey(
        keyData: BufferSource,
        type: 'public' | 'private',
        algorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' },
        usages?: KeyUsage[]
    ): Promise<CryptoKey> {
        const format = type === 'public' ? 'spki' : 'pkcs8';

        // Default usages based on algorithm
        const algoName = (algorithm as any).name || algorithm;
        const defaultUsages: KeyUsage[] = type === 'public'
            ? (algoName === 'ECDH' ? [] : ['verify'])
            : (algoName === 'ECDH' ? ['deriveBits'] : ['sign']);

        return await this.crypto.subtle.importKey(
            format,
            keyData,
            algorithm,
            true,
            usages || defaultUsages
        );
    }

    static async deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
        return await this.crypto.subtle.deriveBits(
            {
                name: 'ECDH',
                public: publicKey,
            },
            privateKey,
            256
        );
    }

    static async hkdf(inputKeyMaterial: BufferSource, salt: BufferSource, info: BufferSource, length: number): Promise<ArrayBuffer> {
        const key = await this.crypto.subtle.importKey(
            'raw',
            inputKeyMaterial,
            { name: 'HKDF' },
            false,
            ['deriveBits']
        );

        return await this.crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: salt,
                info: info,
            },
            key,
            length * 8
        );
    }

    static async hmacSha256(keyData: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
        const key = await this.crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        return await this.crypto.subtle.sign(
            'HMAC',
            key,
            data
        );
    }

    static async encryptAesGcm(key: BufferSource, iv: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
        const cryptoKey = await this.crypto.subtle.importKey(
            'raw',
            key,
            'AES-GCM',
            false,
            ['encrypt']
        );

        return await this.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            cryptoKey,
            data
        );
    }

    static async decryptAesGcm(key: BufferSource, iv: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
        const cryptoKey = await this.crypto.subtle.importKey(
            'raw',
            key,
            'AES-GCM',
            false,
            ['decrypt']
        );

        return await this.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            cryptoKey,
            data
        );
    }

    // Helper to convert Buffer/ArrayBuffer to Uint8Array for easier handling
    static toUint8Array(data: BufferSource | string): Uint8Array {
        if (typeof data === 'string') {
            return new TextEncoder().encode(data);
        }
        if (data instanceof Uint8Array) {
            return data;
        }
        if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        return new Uint8Array(data);
    }

    static toBase64(data: Uint8Array): string {
        // Node.js
        if (typeof (globalThis as any).Buffer !== 'undefined') {
            return (globalThis as any).Buffer.from(data).toString('base64');
        }
        // Browser
        let binary = '';
        const len = data.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(data[i]);
        }
        return btoa(binary);
    }

    static fromBase64(base64: string): Uint8Array {
        // Node.js
        if (typeof (globalThis as any).Buffer !== 'undefined') {
            return new Uint8Array((globalThis as any).Buffer.from(base64, 'base64'));
        }
        // Browser
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
}
