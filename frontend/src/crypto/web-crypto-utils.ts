
// Convert ArrayBuffer to Base64 string
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Convert Base64 string to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// Convert PEM to ArrayBuffer (strips header/footer)
export function pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = pem.replace(/-----BEGIN [^-]+-----/, '')
        .replace(/-----END [^-]+-----/, '')
        .replace(/\s/g, '');
    return base64ToArrayBuffer(b64);
}

// Helper to export key as SPKI (Subject Public Key Info) - standard for public keys
export async function exportPublicKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    return arrayBufferToBase64(exported);
}

// Helper to export key as PKCS8 - standard for private keys
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("pkcs8", key);
    return arrayBufferToBase64(exported);
}

// Import public key from SPKI format
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
    const binaryKey = base64ToArrayBuffer(base64Key);
    return window.crypto.subtle.importKey(
        "spki",
        binaryKey,
        {
            name: "ECDH",
            namedCurve: "P-256", // Using P-256 as in server
        },
        true,
        [] // Public keys don't need usages for import usually, but for ECDH we might need none or deriveKey
    );
}

// Import private key from PKCS8 format
export async function importPrivateKey(base64Key: string): Promise<CryptoKey> {
    const binaryKey = base64ToArrayBuffer(base64Key);
    return window.crypto.subtle.importKey(
        "pkcs8",
        binaryKey,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true,
        ["deriveKey", "deriveBits"]
    );
}
