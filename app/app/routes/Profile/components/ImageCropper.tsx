import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { Button } from "~/components/ui/button";
import { Loader2 } from "lucide-react";
import { Progress } from "~/components/ui/progress";
import type { Area, Point } from "react-easy-crop";

interface ImageCropperProps {
  imageSrc: string;
  onCrop: (croppedFile: File, onProgress?: (progress: number) => void) => void;
  onCancel: () => void;
  isUploading?: boolean;
}

const ImageCropper = ({ imageSrc, onCrop, onCancel, isUploading = false }: ImageCropperProps) => {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", (error) => reject(error));
      image.src = url;
    });

  const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: Area
  ): Promise<Blob> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("No 2d context");
    }

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas is empty"));
          return;
        }
        resolve(blob);
      }, "image/jpeg", 0.95);
    });
  };

  const handleCrop = async () => {
    if (!croppedAreaPixels) return;

    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const file = new File([blob], "profile-pic.jpg", { type: "image/jpeg" });
      
      const progressCallback = (progress: number) => {
        setUploadProgress(progress);
      };
      
      await onCrop(file, progressCallback);
    } catch (error) {
      console.error("Error cropping image:", error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative w-full h-[280px] sm:h-[320px] md:h-[380px] bg-black rounded-lg overflow-hidden">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          cropShape="rect"
          showGrid={true}
          style={{
            containerStyle: {
              width: "100%",
              height: "100%",
            },
          }}
        />
      </div>

      <div className="space-y-4 bg-muted/30 rounded-lg p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Zoom</label>
            <span className="text-sm text-muted-foreground">{Math.round(zoom * 100)}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {isUploading && (
        <div className="space-y-2 bg-muted/30 rounded-lg p-3">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-muted-foreground font-medium">Uploading...</span>
            <span className="text-muted-foreground font-semibold">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="w-full h-2" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isUploading}
          className="w-full sm:w-auto order-2 sm:order-1 h-9 sm:h-10"
        >
          Cancel
        </Button>
        <Button
          onClick={handleCrop}
          disabled={isUploading || !croppedAreaPixels}
          className="w-full sm:w-auto min-w-[140px] order-1 sm:order-2 h-9 sm:h-10"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            "Crop & Upload"
          )}
        </Button>
      </div>
    </div>
  );
};

export default ImageCropper;
