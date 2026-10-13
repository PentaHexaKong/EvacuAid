import { createContext, useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ComponentProps } from "react"
import { Dialog, DialogTrigger, Heading, Popover as AriaPopover, Pressable, Text, Button as AriaButton, PopoverContext, OverlayTriggerStateContext, useContextProps } from "react-aria-components"
import { cx } from "@/utils/cx"

export const Popover = DialogTrigger
export const PopoverTrigger = Pressable

const notificationMotion = "transition-[opacity,scale,filter] duration-150 ease-out data-[entering]:animate-none data-[exiting]:animate-none data-[entering]:scale-95 data-[entering]:opacity-0 data-[entering]:blur-[4px] data-[exiting]:scale-95 data-[exiting]:opacity-0 data-[exiting]:blur-[4px] motion-reduce:transition-none motion-reduce:data-[entering]:scale-100 motion-reduce:data-[entering]:blur-0 motion-reduce:data-[exiting]:scale-100 motion-reduce:data-[exiting]:blur-0"

const PopoverAncestors = createContext<string[]>([])

export function PopoverMenuButton(props: ComponentProps<typeof AriaButton>) {
  const state = useContext(OverlayTriggerStateContext)
  return <AriaButton {...props} onPressStart={(event) => {
    props.onPressStart?.(event)
    if (state?.isOpen && event.pointerType !== "touch" && event.pointerType !== "keyboard") state.close()
  }} />
}

export function PopoverSurface({ variant = "panel", className, children, ...props }: ComponentProps<typeof AriaPopover> & { variant?: "select" | "menu" | "panel" }) {
  const [merged, ref] = useContextProps(props, useRef<HTMLElement>(null), PopoverContext)
  const id = useId()
  const ancestors = useContext(PopoverAncestors)
  const lineage = useMemo(() => [...ancestors, id], [ancestors, id])
  const state = useContext(OverlayTriggerStateContext)
  const [keyboard, setKeyboard] = useState(false)
  const shouldCloseOnInteractOutside = (target: Element) => !ref.current?.contains(target) && !target.closest("[data-popover-ancestors]")?.getAttribute("data-popover-ancestors")?.split(" ").includes(id) && !merged.triggerRef?.current?.contains(target) && (merged.shouldCloseOnInteractOutside?.(target) ?? true)
  const dismissOutside = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Element && ref.current && shouldCloseOnInteractOutside(event.target)) state?.close()
  })
  useEffect(() => {
    const key = () => { setKeyboard(true) }
    const pointer = (event: PointerEvent) => { setKeyboard(false); dismissOutside(event) }
    const scroll = (event: Event) => {
      if (!ref.current) return
      const target = event.target
      if (target instanceof Element && target.closest("[data-board-popover]")) return
      state?.close()
    }
    document.addEventListener("keydown", key, true)
    document.addEventListener("pointerdown", pointer, true)
    document.addEventListener("scroll", scroll, true)
    return () => {
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("pointerdown", pointer, true)
      document.removeEventListener("scroll", scroll, true)
    }
  }, [state, id, ref])
  return <AriaPopover {...merged} trigger={ancestors.length > 0 ? "SubmenuTrigger" : merged.trigger} ref={ref} maxHeight={variant === "panel" ? 480 : 320} isNonModal offset={merged.offset ?? 4} data-board-popover={variant} data-popover-ancestors={lineage.join(" ")} data-keyboard={keyboard}
    style={(values) => ({ ...(typeof merged.style === "function" ? merged.style(values) : merged.style), zIndex: 60 + ancestors.length })}
    shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
    className={(values) => cx("isolate z-60 group/popover flex max-w-[calc(100vw-2rem)] flex-col text-body-medium text-text-primary outline-none origin-[var(--trigger-anchor-point)] data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:duration-150 data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] data-[keyboard=true]:animate-none motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]", variant === "select" ? "w-(--trigger-width)" : variant === "menu" ? "w-56" : "w-72", typeof className === "function" ? className(values) : className)}>{(values) => <PopoverAncestors.Provider value={lineage}><div className={cx("flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown origin-[var(--trigger-anchor-point)] group-data-[entering]/popover:animate-in group-data-[entering]/popover:zoom-in-95 group-data-[entering]/popover:duration-150 group-data-[exiting]/popover:animate-out group-data-[exiting]/popover:zoom-out-95 group-data-[exiting]/popover:duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[keyboard=true]/popover:animate-none motion-reduce:animate-none", variant === "panel" ? "gap-3 p-4" : "p-2")}>{typeof children === "function" ? children(values) : children}</div></PopoverAncestors.Provider>}</AriaPopover>
}

export function PopoverContent({ animation, variant = "panel", className, align = "center", side = "bottom", sideOffset = 4, collisionPadding, children, ...props }: Omit<ComponentProps<typeof AriaPopover>, "className" | "children"> & { animation?: "notification"; variant?: "panel" | "custom"; className?: string; align?: "start" | "center" | "end"; side?: "top" | "bottom" | "left" | "right"; sideOffset?: number; collisionPadding?: number; children: React.ReactNode }) {
  const [merged, ref] = useContextProps(props, useRef<HTMLElement>(null), PopoverContext)
  const state = useContext(OverlayTriggerStateContext)
  const [keyboardMotion, setKeyboardMotion] = useState(false)
  useEffect(() => {
    if (animation !== "notification") return
    const key = () => { setKeyboardMotion(true) }
    const pointer = () => { setKeyboardMotion(false) }
    document.addEventListener("keydown", key, true)
    document.addEventListener("pointerdown", pointer, true)
    return () => {
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("pointerdown", pointer, true)
    }
  }, [animation])
  const dismissOutside = useEffectEvent((event: MouseEvent) => {
    const target = event.target
    if (target instanceof Element && ref.current && !ref.current.contains(target) && !merged.triggerRef?.current?.contains(target) && (merged.shouldCloseOnInteractOutside?.(target) ?? true)) state?.close()
  })
  useEffect(() => {
    if (variant !== "custom" || !state?.isOpen) return
    const scroll = (event: Event) => {
      if (!ref.current) return
      if (event.target instanceof Element && event.target.closest("[data-board-popover]")) return
      state.close()
    }
    const pointer = (event: MouseEvent) => { dismissOutside(event) }
    document.addEventListener("pointerdown", pointer, true)
    document.addEventListener("click", pointer, true)
    document.addEventListener("scroll", scroll, true)
    return () => {
      document.removeEventListener("pointerdown", pointer, true)
      document.removeEventListener("click", pointer, true)
      document.removeEventListener("scroll", scroll, true)
    }
  }, [state, variant, ref])
  const crossAlign = side === "left" || side === "right" ? align === "start" ? "top" : "bottom" : align
  const placement = align === "center" ? side : `${side} ${crossAlign}` as ComponentProps<typeof AriaPopover>["placement"]
  if (variant === "custom") return <AriaPopover isNonModal data-reduced-motion={animation === "notification" && keyboardMotion ? "" : undefined} {...merged} ref={ref} shouldCloseOnInteractOutside={(target) => !merged.triggerRef?.current?.contains(target) && (merged.shouldCloseOnInteractOutside?.(target) ?? true)} data-board-popover="custom" placement={placement} offset={sideOffset} containerPadding={collisionPadding} data-slot="popover-content" className={cx("isolate z-50 flex w-72 flex-col gap-4 rounded-md border border-border-default bg-popover p-2.5 text-caption-1-regular text-popover-foreground shadow-sm outline-hidden duration-100 motion-reduce:duration-0 data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:zoom-out-95 motion-reduce:animate-none", animation === "notification" && notificationMotion, className)}><Dialog className="flex min-h-0 flex-1 flex-col gap-[inherit] outline-none transition-none">{children}</Dialog></AriaPopover>
  return <PopoverSurface {...props} variant="panel" placement={placement} offset={sideOffset} containerPadding={collisionPadding} data-slot="popover-content" className={className}><Dialog className="flex min-h-0 flex-1 flex-col gap-[inherit] outline-none transition-none">{children}</Dialog></PopoverSurface>
}

export function PopoverTitle({ className, ...props }: ComponentProps<typeof Heading>) {
  return <Heading slot="title" {...props} className={cx("font-heading text-body-medium text-balance", className)} />
}

export function PopoverDescription({ className, ...props }: ComponentProps<typeof Text>) {
  return <Text slot="description" {...props} className={cx("text-pretty text-foreground-light", className)} />
}
