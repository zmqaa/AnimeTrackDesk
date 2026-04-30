import type { CSSProperties, ImgHTMLAttributes } from "react";

interface NextImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
}

export default function NextImage({
  src,
  alt,
  fill = false,
  sizes,
  priority: _priority,
  style,
  ...props
}: NextImageProps) {
  const fillStyle: CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }
    : undefined;

  return <img src={src} alt={alt} sizes={sizes} {...props} style={{ ...fillStyle, ...style }} />;
}