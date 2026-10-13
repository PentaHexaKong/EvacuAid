import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay, Text } from "react-aria-components"
import { cx } from "@/utils/cx"
import { DialogContext, useDialog } from "@/components/base/dialog/dialog-context"
import { dialogSizes, type DialogSize } from "@/components/base/dialog/dialog-sizes"
import { useDialogMotion } from "@/components/base/dialog/dialog-motion"

type ChangeDetails = { cancel: () => void }
type DialogProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, details: ChangeDetails) => void
  onOpenChangeComplete?: (open: boolean) => void
  children: ReactNode
}
export function Dialog({ open: controlled, defaultOpen = false, onOpenChange, onOpenChangeComplete, children }: DialogProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const open = controlled ?? uncontrolled
  const latest = useRef({ open, onOpenChangeComplete })
  useLayoutEffect(() => { latest.current = { open, onOpenChangeComplete } }, [open, onOpenChangeComplete])
  const closed = useCallback(() => { if (!latest.current.open) latest.current.onOpenChangeComplete?.(false) }, [])
  const change = useCallback((next: boolean) => {
    const details = { cancelled: false }
    onOpenChange?.(next, { cancel: () => { details.cancelled = true } })
    if (!details.cancelled && controlled === undefined) setUncontrolled(next)
  }, [controlled, onOpenChange])
  const context = useMemo(() => ({ open, change, closed }), [open, change, closed])
  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>
}

export function DialogContent({ className, children, size = "sm", role = "dialog", ...props }: Omit<ComponentProps<typeof AriaDialog>, "children" | "className"> & { className?: string; children: ReactNode; size?: DialogSize }) {
  const { open, change, closed } = useDialog()
  const instant = useDialogMotion()
  const mounted = useRef(false)
  const modalRef = useCallback((node: HTMLDivElement | null) => { if (node) mounted.current = true; else if (mounted.current) { mounted.current = false; queueMicrotask(closed) } }, [closed])
  return <ModalOverlay isOpen={open} onOpenChange={change} isDismissable className={cx("fixed inset-0 z-50 flex items-center justify-center bg-background-scrim/60 p-4 transition-opacity duration-[220ms] data-[entering]:opacity-0 data-[exiting]:opacity-0 data-[exiting]:duration-[160ms] motion-reduce:transition-none", instant && "transition-none")}>
    <Modal className={cx("w-full outline-none transition-[opacity,scale] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[entering]:scale-[0.97] data-[entering]:opacity-0 data-[exiting]:scale-[0.97] data-[exiting]:opacity-0 data-[exiting]:duration-[160ms] motion-reduce:transition-none", dialogSizes[size], instant && "transition-none")} ref={modalRef}>
      <AriaDialog {...props} role={role} data-slot="dialog-content" className={cx("w-full overflow-hidden rounded-lg border border-border-table bg-background-dialog-default text-foreground-default shadow-md outline-none", dialogSizes[size], className)}>{children}</AriaDialog>
    </Modal>
  </ModalOverlay>
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="dialog-header" className={cx("border-b border-border-default px-5 py-3", className)} />
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} data-slot="dialog-footer" className={cx("flex flex-col-reverse gap-2 border-t border-border-default px-5 py-4 sm:flex-row sm:justify-end", className)} />
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof Heading>) {
  return <Heading {...props} slot="title" className={cx("text-headline-medium text-balance text-foreground-default", className)} />
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} slot="description" className={cx("text-body-regular text-text-secondary-strong", className)} />
}
