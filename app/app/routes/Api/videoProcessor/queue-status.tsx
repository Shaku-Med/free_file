import { getCookie } from "~/lib/Security/Token"
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken"
import * as crypto from 'crypto'
import { videoQueue } from './processFunctions/queue'

const VerifyB4VideoProcessing = async (headers: Headers) => {
    try {
      let keys = ['session_id']
  
      let token = getCookie('sessionId', headers)
      if(!token) return null
      let decoded = await VerifyToken({
        token: token,
        addedKeyNames: keys || []
      }, headers)
      if(!decoded) return null
      let sessionIdHex = typeof decoded.sessionID === 'string' ? decoded.sessionID : ''
      let providedHex = headers.get('x-session-id') || ''
      const isHex = (s: string) => /^[0-9a-f]+$/i.test(s)
      if(!isHex(sessionIdHex)) return null
      if(providedHex){
        if(!isHex(providedHex)) return null
        const a = Buffer.from(sessionIdHex.toLowerCase(), 'hex')
        const b = Buffer.from(providedHex.toLowerCase(), 'hex')
        if(a.length !== b.length) return null
        if(!crypto.timingSafeEqual(a, b)) return null
      }
      return true
    }
    catch {
      return null
    }
  }

export const loader = async ({ request }: { request: Request }) => {
    try {
        let verified = await VerifyB4VideoProcessing(request.headers)
        if(!verified) return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        })

        const stats = videoQueue.getQueueStats()
        const isAvailable = stats.processing === 0

        return new Response(JSON.stringify({
            success: true,
            available: isAvailable,
            stats
        }), {
            headers: { 'Content-Type': 'application/json' }
        })

    } catch (error) {
        console.error('Error in queue-status loader:', error)
        return new Response(JSON.stringify({ error: 'Failed to get queue status' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}

