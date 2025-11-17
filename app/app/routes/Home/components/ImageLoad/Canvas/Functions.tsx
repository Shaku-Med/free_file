interface GenerateEffectImageProps {
    src: string
    effect?: 'blur' | 'sepia' | 'grayscale' | 'invert' | 'contrast' | 'brightness' | 'saturate' | 'hue-rotate' | 'opacity' | 'pixelated' | 'colored' | 'drop-shadow' | 'drop-shadow-x' | 'drop-shadow-y' | 'drop-shadow-blur' | 'drop-shadow-color' | 'drop-shadow-opacity' | 'drop-shadow-spread' | 'drop-shadow-inset' | 'drop-shadow-x-inset' | 'drop-shadow-y-inset' | 'drop-shadow-blur-inset' | 'drop-shadow-color-inset' | 'drop-shadow-opacity-inset' | 'drop-shadow-spread-inset',
    effectDeptLevel?: number
}
export const generateEffectImage = async ({src, effect = 'blur', effectDeptLevel = 10}: GenerateEffectImageProps): Promise<string | null> => {
    let canvas: HTMLCanvasElement | null = null
    let ctx: CanvasRenderingContext2D | null = null
    let img: HTMLImageElement | null = null
    
    try {
        if(!src) return null

        img = new Image()
        img.crossOrigin = 'anonymous'
        
        await new Promise<void>((resolve, reject) => {
            img!.onload = () => resolve()
            img!.onerror = () => reject(new Error('Failed to load image'))
            img!.src = src
        })

        canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        ctx = canvas.getContext('2d', { willReadFrequently: false })
        
        if(!ctx) {
            throw new Error('Failed to get canvas context')
        }

        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        const level = Math.max(0, Math.min(100, effectDeptLevel)) / 100

        switch(effect) {
            case 'blur':
                ctx.filter = `blur(${level * 20}px)`
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0)
                break
            case 'grayscale':
                for(let i = 0; i < data.length; i += 4) {
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
                    const mix = gray * level + (data[i] * (1 - level))
                    data[i] = mix
                    data[i + 1] = mix
                    data[i + 2] = mix
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'sepia':
                for(let i = 0; i < data.length; i += 4) {
                    const r = data[i]
                    const g = data[i + 1]
                    const b = data[i + 2]
                    data[i] = Math.min(255, (r * 0.393 + g * 0.769 + b * 0.189) * level + r * (1 - level))
                    data[i + 1] = Math.min(255, (r * 0.349 + g * 0.686 + b * 0.168) * level + g * (1 - level))
                    data[i + 2] = Math.min(255, (r * 0.272 + g * 0.534 + b * 0.131) * level + b * (1 - level))
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'invert':
                for(let i = 0; i < data.length; i += 4) {
                    data[i] = 255 - (255 - data[i]) * level - data[i] * (1 - level)
                    data[i + 1] = 255 - (255 - data[i + 1]) * level - data[i + 1] * (1 - level)
                    data[i + 2] = 255 - (255 - data[i + 2]) * level - data[i + 2] * (1 - level)
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'contrast':
                const contrast = (level - 0.5) * 2
                const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255))
                for(let i = 0; i < data.length; i += 4) {
                    data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128))
                    data[i + 1] = Math.max(0, Math.min(255, factor * (data[i + 1] - 128) + 128))
                    data[i + 2] = Math.max(0, Math.min(255, factor * (data[i + 2] - 128) + 128))
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'brightness':
                for(let i = 0; i < data.length; i += 4) {
                    data[i] = Math.max(0, Math.min(255, data[i] * level))
                    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * level))
                    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * level))
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'saturate':
                for(let i = 0; i < data.length; i += 4) {
                    const r = data[i]
                    const g = data[i + 1]
                    const b = data[i + 2]
                    const gray = r * 0.299 + g * 0.587 + b * 0.114
                    data[i] = Math.max(0, Math.min(255, gray + (r - gray) * level))
                    data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * level))
                    data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * level))
                }
                ctx.putImageData(imageData, 0, 0)
                break
            case 'hue-rotate':
                ctx.filter = `hue-rotate(${level * 360}deg)`
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0)
                break
            case 'opacity':
                ctx.globalAlpha = level
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0)
                ctx.globalAlpha = 1.0
                break
            case 'pixelated':
                const pixelSize = Math.max(2, Math.floor(level * 50 + 2))
                const scaledWidth = Math.max(1, Math.floor(canvas.width / pixelSize))
                const scaledHeight = Math.max(1, Math.floor(canvas.height / pixelSize))
                const tempCanvas = document.createElement('canvas')
                tempCanvas.width = scaledWidth
                tempCanvas.height = scaledHeight
                const tempCtx = tempCanvas.getContext('2d')
                if(tempCtx) {
                    tempCtx.imageSmoothingEnabled = false
                    tempCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight)
                    ctx.imageSmoothingEnabled = false
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height)
                    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height)
                    tempCanvas.width = 0
                    tempCanvas.height = 0
                }
                ctx.imageSmoothingEnabled = true
                break
            case 'colored':
                const colorCount = Math.max(3, Math.floor(level * 10 + 3))
                const colors: string[] = []
                for(let i = 0; i < colorCount; i++) {
                    const x = Math.floor(Math.random() * canvas.width)
                    const y = Math.floor(Math.random() * canvas.height)
                    const pixelIndex = (y * canvas.width + x) * 4
                    if(pixelIndex < data.length) {
                        const r = data[pixelIndex]
                        const g = data[pixelIndex + 1]
                        const b = data[pixelIndex + 2]
                        colors.push(`rgb(${r},${g},${b})`)
                    }
                }
                if(colors.length > 0) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    ctx.globalAlpha = 1.0
                    ctx.drawImage(img, 0, 0)
                    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
                    if(colors.length === 1) {
                        gradient.addColorStop(0, colors[0])
                        gradient.addColorStop(1, colors[0])
                    } else {
                        const step = 1 / (colors.length - 1)
                        colors.forEach((color, index) => {
                            gradient.addColorStop(index * step, color)
                        })
                    }
                    ctx.globalCompositeOperation = 'hard-light'
                    ctx.globalAlpha = Math.max(0.5, level)
                    ctx.fillStyle = gradient
                    ctx.fillRect(0, 0, canvas.width, canvas.height)
                    ctx.globalCompositeOperation = 'source-over'
                    ctx.globalAlpha = 1.0
                } else {
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    ctx.drawImage(img, 0, 0)
                }
                break
            case 'drop-shadow':
            case 'drop-shadow-x':
            case 'drop-shadow-y':
            case 'drop-shadow-blur':
            case 'drop-shadow-color':
            case 'drop-shadow-opacity':
            case 'drop-shadow-spread':
            case 'drop-shadow-inset':
            case 'drop-shadow-x-inset':
            case 'drop-shadow-y-inset':
            case 'drop-shadow-blur-inset':
            case 'drop-shadow-color-inset':
            case 'drop-shadow-opacity-inset':
            case 'drop-shadow-spread-inset':
                const shadowX = effect.includes('x') ? level * 20 : level * 10
                const shadowY = effect.includes('y') ? level * 20 : level * 10
                const shadowBlur = effect.includes('blur') ? level * 20 : level * 5
                ctx.shadowColor = effect.includes('color') ? `rgba(0,0,0,${level})` : 'rgba(0,0,0,0.5)'
                ctx.shadowBlur = shadowBlur
                ctx.shadowOffsetX = shadowX
                ctx.shadowOffsetY = shadowY
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(img, 0, 0)
                ctx.shadowColor = 'transparent'
                ctx.shadowBlur = 0
                ctx.shadowOffsetX = 0
                ctx.shadowOffsetY = 0
                break
        }

        const blob = await new Promise<Blob | null>((resolve) => {
            canvas!.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
        })
        
        if(!blob) {
            throw new Error('Failed to create blob')
        }
        
        const blobURL = URL.createObjectURL(blob)
        
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        canvas.width = 0
        canvas.height = 0
        canvas = null
        ctx = null
        img.src = ''
        img = null

        return blobURL
    }
    catch (error) {
        if(ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            canvas.width = 0
            canvas.height = 0
        }
        if(img) {
            img.src = ''
        }
        console.error(error)
        return null
    }
}

export const getImageColorsHEX = async ({src}: {src: string}): Promise<string[] | null> => {
    let canvas: HTMLCanvasElement | null = null
    let ctx: CanvasRenderingContext2D | null = null
    let img: HTMLImageElement | null = null
    
    try {
        if(!src) return null

        img = new Image()
        img.crossOrigin = 'anonymous'
        
        await new Promise<void>((resolve, reject) => {
            img!.onload = () => resolve()
            img!.onerror = () => reject(new Error('Failed to load image'))
            img!.src = src
        })

        canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        ctx = canvas.getContext('2d', { willReadFrequently: true })
        
        if(!ctx) {
            throw new Error('Failed to get canvas context')
        }

        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data

        const sampleRate = Math.max(1, Math.floor((canvas.width * canvas.height) / 10000))
        const colorMap = new Map<string, number>()
        
        for(let i = 0; i < data.length; i += 4 * sampleRate) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const a = data[i + 3]
            
            if(a < 128) continue
            
            const quantizedR = Math.floor(r / 16) * 16
            const quantizedG = Math.floor(g / 16) * 16
            const quantizedB = Math.floor(b / 16) * 16
            
            const hex = `#${quantizedR.toString(16).padStart(2, '0')}${quantizedG.toString(16).padStart(2, '0')}${quantizedB.toString(16).padStart(2, '0')}`
            
            colorMap.set(hex, (colorMap.get(hex) || 0) + 1)
        }

        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([color]) => color)
            .slice(0, 10)

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        canvas.width = 0
        canvas.height = 0
        canvas = null
        ctx = null
        img.src = ''
        img = null

        return sortedColors.length > 0 ? sortedColors : null
    }
    catch (error) {
        if(ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            canvas.width = 0
            canvas.height = 0
        }
        if(img) {
            img.src = ''
        }
        console.error(error)
        return null
    }
}