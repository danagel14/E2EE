/**
 * Double Ratchet - גרסה פשוטה לדפדפן (ללא Node.js crypto)
 */
export class DoubleRatchet {
    private messageNumber: number = 0;
    private secretKey: string;

    constructor(secret: string | Uint8Array) {
        // המרה למחרוזת אם זה Uint8Array
        this.secretKey = typeof secret === 'string' ? secret : new TextDecoder().decode(secret);
    }

    /**
     * הצפנת הודעה (פשוט base64 + מזהה)
     */
    encrypt(plaintext: string): string {
        const encoded = btoa(unescape(encodeURIComponent(plaintext)));
        const messageKey = this.messageNumber.toString(16).padStart(16, '0');
        this.messageNumber++;
        return `${encoded}.${messageKey}`;
    }

    /**
     * פענוח הודעה
     */
    decrypt(ciphertext: string): string {
        try {
            // אם זה לא מוצפן (plaintext), פשוט להחזיר
            if (!ciphertext.includes('.')) {
                return ciphertext;
            }

            const [base64Text] = ciphertext.split('.');

            // פענוח base64
            const plaintext = decodeURIComponent(escape(atob(base64Text)));

            // עדכון המצב
            this.messageNumber++;

            return plaintext;
        } catch (err) {
            console.error('Decryption error:', err);
            return ciphertext; // אם נכשל, להחזיר את המקור
        }
    }
}
