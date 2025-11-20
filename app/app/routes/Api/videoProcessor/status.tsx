import { getCookie } from "~/lib/Security/Token"
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken"
import * as crypto from 'crypto'
import { readFile, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
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

export const loader = async ({ request, params }: { request: Request; params: { queueID?: string } }) => {
    try {
        let verified = await VerifyB4VideoProcessing(request.headers)
        if(!verified) return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        })

        const queueID = params.queueID
        if (!queueID) {
            return new Response(JSON.stringify({ error: 'Missing queueID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const job = videoQueue.getJobStatus(queueID)
        if (!job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        if (job.status === 'completed') {
            return new Response(JSON.stringify({
                success: true,
                status: 'completed',
                jobId: job.jobId,
                progress: 100
            }), {
                headers: { 'Content-Type': 'application/json' }
            })
        }

        let progress = 0
        if (job.status === 'processing' && job.startedAt) {
            const elapsed = Date.now() - job.startedAt
            progress = Math.min(30 + Math.floor((elapsed / 600000) * 65), 95)
        } else if (job.status === 'pending') {
            progress = 10
        } else if (job.status === 'failed') {
            progress = 0
        }

        return new Response(JSON.stringify({
            success: true,
            status: job.status,
            jobId: job.jobId,
            progress
        }), {
            headers: { 'Content-Type': 'application/json' }
        })

    } catch (error) {
        console.error('Error in status loader:', error)
        return new Response(JSON.stringify({ error: 'Failed to get job status' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}
