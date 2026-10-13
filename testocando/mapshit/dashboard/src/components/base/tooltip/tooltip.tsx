import { createContext, useContext } from "react"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { Focusable, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components"
import { cx } from "@/utils/cx"

const DelayContext = createContext(0)

export function TooltipProvider({ children, delayDuration = 0 }: { children: ReactNode; delayDuration?: number }) {
  return <DelayContext.Provider value={delayDuration}>{children}</DelayContext.Provider>
}

export function Tooltip(props: ComponentProps<typeof AriaTooltipTrigger>) {
  const delay = useContext(DelayContext)
  return <AriaTooltipTrigger delay={delay} closeDelay={0} {...props} />
}

export function TooltipTrigger({ children }: { children: ReactElement }) {
  return <Focusable>{children as ComponentProps<typeof Focusable>["children"]}</Focusable>
}

export function TooltipContent({ className, side = "top", sideOffset = 10, size = "sm", ...props }: Omit<ComponentProps<typeof AriaTooltip>, "className"> & { className?: string; side?: "top" | "bottom" | "left" | "right"; sideOffset?: number; size?: "sm" | "md" }) {
  return <AriaTooltip {...props} placement={side} offset={sideOffset} data-slot="tooltip-content" data-size={size} className={cx("pointer-events-none z-50 max-w-[240px] select-none rounded-lg border border-border-button-default bg-background-primary-default text-text-primary shadow-dropdown", size === "sm" ? "px-2.5 py-1.5 text-caption-1-medium" : "px-3 py-2 text-body-medium", "transition duration-200 ease-out data-[entering]:scale-90 data-[entering]:opacity-0 data-[entering]:blur-[4px] data-[exiting]:scale-90 data-[exiting]:opacity-0 data-[exiting]:blur-[4px] motion-reduce:transition-none motion-reduce:data-[entering]:scale-100 motion-reduce:data-[entering]:blur-0 motion-reduce:data-[exiting]:scale-100 motion-reduce:data-[exiting]:blur-0", className)} />
}
