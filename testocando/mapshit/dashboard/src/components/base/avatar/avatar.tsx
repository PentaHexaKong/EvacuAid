import type { HTMLAttributes, Ref } from "react";

import { cx, sortCx } from "@/utils/cx";

type AvatarSize = "xs" | "sm" | "md" | "lg";
type AvatarColor = "neutral" | "blue" | "lime" | "pink" | "purple" | "cyan" | "orange";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  size?: AvatarSize;
  color?: AvatarColor;
  src?: string;
  alt?: string;
  initials?: string;
  ref?: Ref<HTMLSpanElement>;
}

const styles = sortCx({
  base: "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-center align-middle transition-[width,height,font-size] duration-200 ease",
  size: {
    xs: "size-5 text-[10px] leading-[15px] font-semibold",
    sm: "size-6 text-caption-1-semibold tracking-normal",
    md: "size-8 text-headline-semibold",
    lg: "size-9 text-[18px] leading-6 font-semibold",
  },
  color: {
    neutral: "bg-avatar-neutral-background text-text-secondary",
    blue: "bg-blue-300 text-blue-900",
    lime: "bg-lime-200 text-lime-700",
    pink: "bg-pink-200 text-pink-500",
    purple: "bg-purple-200 text-purple-700",
    cyan: "bg-cyan-200 text-cyan-800",
    orange: "bg-orange-200 text-orange-700",
  },
});

export function Avatar({
  size = "md",
  color = "neutral",
  src,
  alt,
  initials,
  className,
  ref,
  ...props
}: AvatarProps) {
  return (
    <span
      ref={ref}
      className={cx(styles.base, styles.size[size], styles.color[color], className)}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}
