import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ToggleButton, ToggleButtonGroup, type ToggleButtonGroupProps, type ToggleButtonProps } from "react-aria-components"

import { cx } from "@/utils/cx"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

type SegmentedControlProps = Omit<ToggleButtonGroupProps, "children" | "className" | "disallowEmptySelection" | "selectionMode"> & {
  children: ReactNode
  className?: string
}

type SegmentedControlItemProps = Omit<ToggleButtonProps, "className"> & { className?: string }

export function SegmentedControl({ className, children, ...props }: SegmentedControlProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumbStyle, setThumbStyle] = useState<CSSProperties>()

  useIsomorphicLayoutEffect(() => {
    const container = ref.current
    if (!container) return

    const updateThumb = () => {
      const selected = container.querySelector<HTMLElement>("[data-selected]")
      if (!selected) return
      setThumbStyle({
        height: selected.offsetHeight,
        transform: `translate(${String(selected.offsetLeft)}px, ${String(selected.offsetTop)}px)`,
        width: selected.offsetWidth,
      })
    }

    updateThumb()
    const mutationObserver = new MutationObserver(updateThumb)
    const resizeObserver = new ResizeObserver(updateThumb)
    mutationObserver.observe(container, { attributeFilter: ["data-selected"], attributes: true, subtree: true })
    resizeObserver.observe(container)
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  return <ToggleButtonGroup {...props} className={cx("relative inline-flex items-start gap-0.5 rounded-2lg bg-segmented-control-background p-1", className)} disallowEmptySelection ref={ref} selectionMode="single">
    <span aria-hidden className="pointer-events-none absolute top-0 left-0 rounded-md bg-segmented-control-selected-background shadow-2xs transition-[transform,width,height] duration-200 ease motion-reduce:transition-none" style={thumbStyle} />
    {children}
  </ToggleButtonGroup>
}

export function SegmentedControlItem({ className, ...props }: SegmentedControlItemProps) {
  return <ToggleButton {...props} className={({ isDisabled, isFocusVisible, isHovered, isSelected }) => cx(
    "relative z-10 inline-flex cursor-pointer items-center justify-center rounded-md px-2.5 py-1 text-center whitespace-nowrap outline-none transition-colors duration-200 ease motion-reduce:transition-none",
    isFocusVisible && "ring-2 ring-border-focus-ring ring-offset-2",
    isSelected ? "text-body-medium text-text-primary" : "text-body-regular text-text-secondary",
    isHovered && !isSelected && !isDisabled && "text-text-primary",
    isDisabled && !isSelected && "cursor-not-allowed opacity-40",
    className,
  )} />
}
