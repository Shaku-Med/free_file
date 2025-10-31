class ClientEncryption {
    private sharedSecret: CryptoKey | null
    private keyPair?: CryptoKeyPair

    constructor() {
        this.sharedSecret = null
    }

    async generateKeys(): Promise<void> {
        this.keyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        )
    }

    async getPublicKey(): Promise<string> {
        if (!this.keyPair) throw new Error('Keys not generated')
        const exported = await crypto.subtle.exportKey('raw', this.keyPair.publicKey)
        return this.arrayBufferToBase64(exported)
    }

    async deriveSharedSecret(serverPublicKeyB64: string): Promise<void> {
        if (!this.keyPair) throw new Error('Keys not generated')
        const serverPublicKey = this.base64ToArrayBuffer(serverPublicKeyB64)

        const importedServerKey = await crypto.subtle.importKey(
            'raw',
            serverPublicKey,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        )

        const sharedSecret = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: importedServerKey },
            this.keyPair.privateKey,
            256
        )

        this.sharedSecret = await crypto.subtle.importKey(
            'raw',
            await crypto.subtle.digest('SHA-256', sharedSecret),
            { name: 'AES-CBC', length: 256 },
            false,
            ['encrypt', 'decrypt']
        )
    }

    async encrypt(message: string): Promise<{ iv: string; data: string }> {
        if (!this.sharedSecret) throw new Error('Shared secret not derived')
        const iv = crypto.getRandomValues(new Uint8Array(16))
        const encoded = new TextEncoder().encode(message)

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-CBC', iv },
            this.sharedSecret,
            encoded
        )

        return {
            iv: this.arrayBufferToBase64(iv),
            data: this.arrayBufferToBase64(encrypted)
        }
    }

    async decrypt(encryptedData: { iv: string; data: string }): Promise<string> {
        if (!this.sharedSecret) throw new Error('Shared secret not derived')
        const iv = this.base64ToArrayBuffer(encryptedData.iv)
        const data = this.base64ToArrayBuffer(encryptedData.data)

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            this.sharedSecret,
            data
        )

        return new TextDecoder().decode(decrypted)
    }

    async getSharedSecretBase64(): Promise<string> {
        if (!this.sharedSecret) throw new Error('Shared secret not derived')
        const exported = await crypto.subtle.exportKey('raw', this.sharedSecret)
        return this.arrayBufferToBase64(exported)
    }

    private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
    }
}

export default ClientEncryption


