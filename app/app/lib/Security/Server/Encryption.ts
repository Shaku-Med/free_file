import * as crypto from 'crypto'

export class ServerEncryption {
  private ecdh: crypto.ECDH
  private publicKey: Buffer
  private sharedSecret: Buffer | null

  constructor() {
    const ecdh = crypto.createECDH('prime256v1')
    ecdh.generateKeys()
    
    this.ecdh = ecdh
    this.publicKey = ecdh.getPublicKey()
    this.sharedSecret = null
  }

  getPublicKey(): string {
    return this.publicKey.toString('base64')
  }

  deriveSharedSecret(clientPublicKey: string): Buffer {
    const clientPublicKeyBuffer = Buffer.from(clientPublicKey, 'base64')
    this.sharedSecret = this.ecdh.computeSecret(clientPublicKeyBuffer)
    return this.sharedSecret
  }

  encrypt(message: string): { iv: string; data: string } {
    if (!this.sharedSecret) throw new Error('No shared secret')

    const iv = crypto.randomBytes(16)
    const key = crypto.createHash('sha256').update(this.sharedSecret).digest()
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    
    let encrypted = cipher.update(message, 'utf8', 'base64')
    encrypted += cipher.final('base64')
    
    return { iv: iv.toString('base64'), data: encrypted }
  }

  decrypt(encryptedData: { iv: string; data: string }): string {
    if (!this.sharedSecret) throw new Error('No shared secret')

    const iv = Buffer.from(encryptedData.iv, 'base64')
    const key = crypto.createHash('sha256').update(this.sharedSecret).digest()
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    
    let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  }

  getSharedSecretBase64(): string {
    if (!this.sharedSecret) throw new Error('No shared secret')
    return this.sharedSecret.toString('base64')
  }
}


