interface VideoJob {
    jobId: string
    filePath: string
    outputPath: string
    uniqueID: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    createdAt: number
    startedAt?: number
    completedAt?: number
    error?: string
    isAdult?: boolean
    timestamp?: number
    headers?: Headers
    baseUrl?: string
    options: {
        outputFormat: 'mp4' | 'hls'
        quality: 'low' | 'medium' | 'high'
    }
}

class VideoProcessingQueue {
    private queue: VideoJob[] = []
    private processing: Set<string> = new Set()
    private maxConcurrent: number = 1
    private maxQueueSize: number = 1000
    private isProcessing: boolean = false

    addJob(job: Omit<VideoJob, 'status' | 'createdAt'>): boolean {
        if (this.queue.length >= this.maxQueueSize) {
            return false
        }

        const newJob: VideoJob = {
            ...job,
            status: 'pending',
            createdAt: Date.now()
        }

        this.queue.push(newJob)
        this.processQueue().catch((error) => {
            console.error('Error processing queue:', error)
        })
        return true
    }

    getJobStatus(jobId: string): VideoJob | null {
        const job = this.queue.find(j => j.jobId === jobId)
        return job || null
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.processing.size >= this.maxConcurrent) {
            return
        }

        const pendingJob = this.queue.find(j => j.status === 'pending')
        if (!pendingJob) {
            return
        }

        if (this.processing.has(pendingJob.jobId)) {
            return
        }

        this.isProcessing = true
        this.processing.add(pendingJob.jobId)
        pendingJob.status = 'processing'
        pendingJob.startedAt = Date.now()
        
        try {
            await this.processJob(pendingJob)
        } catch (error) {
            console.error('Error processing job:', error)
        } finally {
            this.processing.delete(pendingJob.jobId)
            this.isProcessing = false
            
            setTimeout(() => {
                this.processQueue().catch((error) => {
                    console.error('Error processing next queue item:', error)
                })
            }, 100)
        }
    }

    private async processJob(job: VideoJob): Promise<void> {
        const { unlink, readFile, readdir } = await import('fs/promises')
        const { join } = await import('path')
        const { existsSync } = await import('fs')
        
        try {
            const { processVideo } = await import('./processor')
            const timestamp = Date.now()
            job.timestamp = timestamp
            
            const result = await processVideo(
                job.filePath,
                job.outputPath,
                job.options
            )

            if (result.success) {
                const { FileService } = await import('~/lib/Services/FileService')
                const { config } = await import('~/lib/config')
                
                const fileService = new FileService(
                    config.github.token,
                    config.github.owner
                )
                await fileService.initialize()
                
                if (job.options.outputFormat === 'hls') {
                    const tempDir = join(process.cwd(), 'temp')
                    const m3u8Content = await readFile(job.outputPath, 'utf-8')
                    const files = await readdir(tempDir)
                    const segmentFiles = files.filter(f => f.startsWith(`segment_${timestamp}_`) && f.endsWith('.ts'))
                    
                    const uploadPromises: Promise<void>[] = []
                    
                    const m3u8Blob = new Blob([m3u8Content], { type: 'application/vnd.apple.mpegurl' })
                    const m3u8File = new File([m3u8Blob], `${job.uniqueID}.m3u8`, { type: 'application/vnd.apple.mpegurl' })
                    
                    uploadPromises.push(
                        fileService.uploadFile({
                            file: m3u8File,
                            uniqueID: job.uniqueID,
                            filename: `${job.uniqueID}.m3u8`,
                            isAdult: job.isAdult
                        }).then((result) => {
                            if (!result.success) {
                                console.error(`Failed to upload m3u8 file:`, result.error)
                                throw new Error(result.error || 'M3U8 upload failed')
                            }
                        })
                    )
                    
                    for (const segFile of segmentFiles) {
                        const segPath = join(tempDir, segFile)
                        const segData = await readFile(segPath)
                        const segBlob = new Blob([segData], { type: 'video/mp2t' })
                        const segFileObj = new File([segBlob], segFile, { type: 'video/mp2t' })
                        
                        uploadPromises.push(
                            fileService.uploadFile({
                                file: segFileObj,
                                uniqueID: job.uniqueID,
                                filename: segFile,
                                isAdult: undefined
                            }).then((result) => {
                                if (!result.success) {
                                    console.error(`Failed to upload segment ${segFile}:`, result.error)
                                    throw new Error(result.error || `Segment ${segFile} upload failed`)
                                }
                            })
                        )
                    }
                    
                    const uploadResults = await Promise.allSettled(uploadPromises)
                    const failedUploads = uploadResults.filter(r => r.status === 'rejected')
                    if (failedUploads.length > 0) {
                        console.error(`Failed to upload ${failedUploads.length} file(s) out of ${uploadResults.length}`)
                        failedUploads.forEach((result) => {
                            if (result.status === 'rejected') {
                                console.error(`Upload failed:`, result.reason)
                            }
                        })
                        throw new Error(`Failed to upload ${failedUploads.length} file(s)`)
                    }
                    
                    await unlink(job.filePath).catch(() => {})
                    await unlink(job.outputPath).catch(() => {})
                    for (const segFile of segmentFiles) {
                        await unlink(join(tempDir, segFile)).catch(() => {})
                    }
                } else {
                    const outputBuffer = await readFile(job.outputPath)
                    const outputBlob = new Blob([outputBuffer], { type: 'video/mp4' })
                    const outputFile = new File([outputBlob], `${job.uniqueID}.mp4`, { type: 'video/mp4' })
                    
                    await fileService.uploadFile({
                        file: outputFile,
                        uniqueID: job.uniqueID,
                        filename: `${job.uniqueID}.mp4`,
                        isAdult: job.isAdult
                    })
                    
                    await unlink(job.filePath).catch(() => {})
                    await unlink(job.outputPath).catch(() => {})
                }
                
                job.status = 'completed'
                job.completedAt = Date.now()
            } else {
                job.status = 'failed'
                job.error = result.error
                job.completedAt = Date.now()
                await unlink(job.filePath).catch(() => {})
                await unlink(job.outputPath).catch(() => {})
            }
        } catch (error) {
            job.status = 'failed'
            job.error = error instanceof Error ? error.message : 'Unknown error'
            job.completedAt = Date.now()
            await unlink(job.filePath).catch(() => {})
            await unlink(job.outputPath).catch(() => {})
        }
    }

    getQueueStats() {
        return {
            total: this.queue.length,
            pending: this.queue.filter(j => j.status === 'pending').length,
            processing: this.processing.size,
            completed: this.queue.filter(j => j.status === 'completed').length,
            failed: this.queue.filter(j => j.status === 'failed').length
        }
    }

    cleanup(olderThan: number = 3600000) {
        const now = Date.now()
        this.queue = this.queue.filter(job => {
            if (job.completedAt && (now - job.completedAt) > olderThan) {
                return false
            }
            if (job.status === 'failed' && job.completedAt && (now - job.completedAt) > olderThan) {
                return false
            }
            return true
        })
    }
}

export const videoQueue = new VideoProcessingQueue()

setInterval(() => {
    videoQueue.cleanup()
}, 600000)

