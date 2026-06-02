import type React from "react";
import { forwardRef, useImperativeHandle, useRef, type ElementType, type ReactNode, type RefObject } from "react";
import { useAdaptiveTone, type Tone } from "~/lib/useAdaptiveTone";
import { cn } from "~/lib/utils";

interface AdaptiveToneProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** The image being viewed; we sample its pixels. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** Re-sample when this changes (e.g. zoom/pan state). */
  trigger?: unknown;
  /** Element tag. Defaults to "div"; pass "button" for an adaptive button. */
  as?: ElementType;
  /** Applied when the area behind is dark  use light controls. */
  light?: string;
  /** Applied when the area behind is bright  use dark controls. */
  dark?: string;
  /** Initial tone before first sample (defaults to "light"). */
  defaultTone?: Tone;
  children?: ReactNode | ((tone: Tone) => ReactNode);
}

// Drop-in wrapper. Renders any element with light/dark classes auto-flipped
// based on the pixels behind it in `imageRef`. Works with any image element
// you've mounted yourself  no need to modify your image component.
//
// Usage:
//   <AdaptiveTone
//     imageRef={imgRef}
//     trigger={zoomState}
//     as="button"
//     className="absolute top-4 right-4 h-10 w-10 rounded-full transition-colors"
//     light="bg-black/40 text-white hover:bg-black/60"
//     dark="bg-white/40 text-black hover:bg-white/60"
//     onClick={onClose}
//   >
//     <X className="h-5 w-5" />
//   </AdaptiveTone>
export const AdaptiveTone = forwardRef<HTMLElement, AdaptiveToneProps>(
  function AdaptiveTone(
    {
      imageRef,
      trigger,
      as: As = "div",
      className,
      light,
      dark,
      defaultTone = "light",
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLElement | null>(null);
    useImperativeHandle(forwardedRef, () => localRef.current as HTMLElement);

    const tone = useAdaptiveTone({
      imageRef,
      targetRef: localRef,
      defaultTone,
      trigger,
    });

    const Component = As as ElementType;
    return (
      <Component
        ref={localRef}
        className={cn(className, tone === "light" ? light : dark)}
        {...rest}
      >
        {typeof children === "function" ? children(tone) : children}
      </Component>
    );
  },
);

export default AdaptiveTone;
