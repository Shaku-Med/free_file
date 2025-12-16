import { getCookie } from "~/lib/Security/Token"
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken"
import * as crypto from 'crypto'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { videoQueue } from './processFunctions/queue'
import { isAuthenticated } from "~/lib/Security/Password"

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

export const action = async ({ request }: { request: Request }) => {
    try {
        let verified = await VerifyB4VideoProcessing(request.headers)
        if(!verified) return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        })

        if (videoQueue.isBusy()) {
            return new Response(JSON.stringify({ error: 'Processing in progress' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const formData = await request.formData()
        const videoFile = formData.get('video') as File
        const uniqueID = formData.get('uniqueID') as string
        const outputFormat = (formData.get('outputFormat') as string) || 'hls'
        const quality = (formData.get('quality') as string) || 'medium'
        const fileTitle = formData.get('title') as string | null
        const fileDescription = formData.get('description') as string | null

        if (!videoFile || !uniqueID) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const user = await isAuthenticated(request, ['id'])
        const ownerId = user && typeof user !== 'boolean' && user.id ? user.id : process.env.DEFAULT_ID
        const maxBytes = ownerId === process.env.DEFAULT_ID ? 50 * 1024 * 1024 : 400 * 1024 * 1024

        if (videoFile.size > maxBytes) {
            const label = maxBytes >= 400 * 1024 * 1024 ? '400MB' : '50MB'
            return new Response(JSON.stringify({ error: `File exceeds maximum size of ${label}` }), {
                status: 413,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const tempDir = join(process.cwd(), 'temp')
        if (!existsSync(tempDir)) {
            await mkdir(tempDir, { recursive: true })
        }

        const jobId = randomUUID()
        const inputPath = join(tempDir, `input_${jobId}.mp4`)
        const outputPath = outputFormat === 'hls'
            ? join(tempDir, `output_${jobId}.m3u8`)
            : join(tempDir, `output_${jobId}.mp4`)

        const arrayBuffer = await videoFile.arrayBuffer()
        await writeFile(inputPath, Buffer.from(arrayBuffer))

        const isAdultParam = formData.get('isAdult') as string | null
        const isAdult = isAdultParam === 'true' ? true : (isAdultParam === 'false' ? false : false)

        const origin = request.headers.get('origin') || request.headers.get('host') || 'http://localhost:3000'
        const baseUrl = origin.startsWith('http') ? origin : `http://${origin}`

        const added = videoQueue.addJob({
            jobId,
            filePath: inputPath,
            outputPath,
            uniqueID,
            isAdult,
            headers: request.headers,
            baseUrl,
            filename: videoFile.name,
            ownerId: ownerId || undefined,
            fileTitle: fileTitle || undefined,
            fileDescription: fileDescription || undefined,
            options: {
                outputFormat: outputFormat as 'mp4' | 'hls',
                quality: quality as 'low' | 'medium' | 'high'
            }
        })

        if (!added) {
            await unlink(inputPath).catch(() => {})
            return new Response(JSON.stringify({ error: 'Queue is full' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        return new Response(JSON.stringify({
            success: true,
            jobId,
            status: 'pending'
        }), {
            headers: { 'Content-Type': 'application/json' }
        })

    } catch (error) {
        console.error('Error in videoProcessor action:', error)
        return new Response(JSON.stringify({ error: 'Processing failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}

