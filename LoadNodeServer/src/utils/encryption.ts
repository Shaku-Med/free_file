async function encrypt(data: string | object, privateKey: string): Promise<string> {
    if (!privateKey || privateKey.length < 16) {
        throw new Error('Private key must be at least 16 characters long');
    }
    
    const textEncoder = new TextEncoder();
    const dataString = typeof data === 'object' ? JSON.stringify(data) : data;
    
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(privateKey),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedData = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            tagLength: 128
        },
        key,
        textEncoder.encode(dataString)
    );
    
    const encryptedArray = new Uint8Array(encryptedData);
    const resultArray = new Uint8Array(salt.length + iv.length + encryptedArray.length);
    resultArray.set(salt, 0);
    resultArray.set(iv, salt.length);
    resultArray.set(encryptedArray, salt.length + iv.length);
    
    return btoa(String.fromCharCode(...resultArray));
}

async function decrypt(encryptedString: string, privateKey: string): Promise<string> {
    if (!privateKey || privateKey.length < 16) {
        throw new Error('Private key must be at least 16 characters long');
    }
    
    if (!encryptedString) {
        throw new Error('Encrypted string cannot be empty');
    }
    
    try {
        const textEncoder = new TextEncoder();
        const textDecoder = new TextDecoder();
        
        const encryptedData = Uint8Array.from(atob(encryptedString), c => c.charCodeAt(0));
        
        if (encryptedData.length < 28) {
            throw new Error('Invalid encrypted data format');
        }
        
        const salt = encryptedData.slice(0, 16);
        const iv = encryptedData.slice(16, 28);
        const data = encryptedData.slice(28);
        
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            textEncoder.encode(privateKey),
            { name: 'PBKDF2' },
            false,
            ['deriveBits', 'deriveKey']
        );
        
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128
            },
            key,
            data
        );
        
        return textDecoder.decode(decryptedData);
    } catch (error) {
        if (error instanceof Error && error.message.includes('operation-specific')) {
            throw new Error('Decryption failed: incorrect key or corrupted data');
        }
        throw error;
    }
}

export { encrypt, decrypt };
