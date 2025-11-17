import React from 'react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Dialog, DialogContent } from '~/components/ui/dialog'
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad'
import { motion } from 'framer-motion'

interface ImagePreviewProps {
    imageUrl: {
        url: string
        imageID: string
    }
    setImageUrl: (imageUrl: {
        url: string
        imageID: string
    } | null) => void
}
const ImagePreview = ({ imageUrl, setImageUrl }: ImagePreviewProps) => {
    return (
        <Dialog open={!!imageUrl} onOpenChange={() => setImageUrl(null)}>
            <DialogContent className={`w-full h-full min-w-full rounded-none border-none p-0`}>
                <motion.div
                 transition={{ duration: 0.2 }}
                 className={`w-full h-screen min-w-full rounded-none border-none p-`}
                 layoutId={`image_id_${imageUrl.imageID}`}>
                    <TransformWrapper>
                        <TransformComponent wrapperStyle={{ width: '100%', height: `100%`, maxHeight: '100%' }} contentStyle={{ width: 'fit-content', height: '100%' }}>
                            <motion.img transition={{ duration: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} src={imageUrl.url} alt="Image" className="w-full h-full object-contain" />
                        </TransformComponent>
                    </TransformWrapper>
                </motion.div>
            </DialogContent>
        </Dialog>
    )
}

export default ImagePreview