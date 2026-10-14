import type { HTMLAttributes, Ref } from "react"
import { cx, sortCx } from "@/utils/cx"

type ChipVariant = "bold" | "subtle" | "caption" | "compact"
type ChipColor = "lime" | "rose" | "yellow" | "cyan" | "blue" | "purple" | "neutral" | "gray" | "soft" | "segmented"

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant
  color?: ChipColor
  ref?: Ref<HTMLSpanElement>
}

const styles = sortCx({
  base: "inline-flex items-center justify-center rounded-md px-1.5 whitespace-nowrap capitalize transition-[padding,font-size] duration-200 ease",
  variant: {
    bold: "py-0.5 text-body-medium",
    subtle: "py-1 text-body-medium",
    caption: "py-1 text-caption-1-medium",
    compact: "min-w-5 px-1 py-0.5 text-caption-1-medium tabular-nums",
  },
  color: {
    lime: "bg-status-lime-background text-status-lime-text",
    rose: "bg-status-rose-background text-status-rose-text",
    yellow: "bg-status-yellow-background text-status-yellow-text",
    cyan: "bg-status-cyan-background text-status-cyan-text",
    blue: "bg-status-blue-background text-status-blue-text",
    purple: "bg-status-purple-background text-status-purple-text",
    neutral: "bg-background-tertiary-default text-text-secondary",
    gray: "bg-background-secondary-default text-text-primary",
    soft: "bg-background-secondary-default text-text-secondary",
    segmented: "bg-segmented-control-background text-text-secondary",
  },
})

export function Chip({ variant = "subtle", color = "neutral", className, ref, ...props }: ChipProps) {
  return <span ref={ref} className={cx(styles.base, styles.variant[variant], styles.color[color], className)} {...props} />
}
