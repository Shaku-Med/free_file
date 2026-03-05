import { useEffect } from "react";

interface ImgLoaderProps {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  getImgColors?: boolean;
  onGetImgColorsCallback?: (colors: string[]) => void;
}

export default function ImgLoader({
  src,
  alt,
  className = "",
  imageClassName = "",
  loading = "eager",
  fetchPriority,
  getImgColors,
  onGetImgColorsCallback,
}: ImgLoaderProps) {
  useEffect(() => {
    if (getImgColors && onGetImgColorsCallback) {
      onGetImgColorsCallback([]);
    }
  }, [getImgColors, onGetImgColorsCallback]);

  return (
    <div className={className}>
      <img
        src={src}
        alt={alt}
        className={imageClassName}
        loading={loading}
        fetchPriority={fetchPriority}
        draggable={false}
      />
    </div>
  );
}
