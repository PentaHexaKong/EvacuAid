import type { ComponentProps } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./dialog"
import { useDialog } from "./dialog-context"
import { Button } from "@/components/base/buttons/button"
import { CloseButton } from "@/components/base/buttons/close-button"
import { FORM_DIALOG_BODY_CLASS, FORM_DIALOG_CONTENT_CLASS, FORM_DIALOG_FOOTER_CLASS } from "@/components/app/FormDialog"
import { cx } from "@/utils/cx"

export { Dialog as AlertDialog, DialogTitle as AlertDialogTitle, DialogDescription as AlertDialogDescription }
export function AlertDialogContent({ className, size = "sm", ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent {...props} size={size} role="alertdialog" className={cx(FORM_DIALOG_CONTENT_CLASS, "p-px pb-3", className)} />
}
export function AlertDialogHeader({ className, children, closeDisabled = false, ...props }: ComponentProps<"div"> & { closeDisabled?: boolean }) {
  const { change } = useDialog()
  return <div {...props} className={cx("flex shrink-0 items-start justify-between gap-4", className)}>{children}<CloseButton aria-label="Close" size="sm" disabled={closeDisabled} onClick={() => { change(false) }} /></div>
}
export function AlertDialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx(FORM_DIALOG_BODY_CLASS, "rounded-[calc(var(--radius-2xl)-2px)]", className)} />
}
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", FORM_DIALOG_FOOTER_CLASS, className)} />
}
export function AlertDialogCancel({ onClick, ...props }: ComponentProps<typeof Button>) {
  const { change } = useDialog()
  return <Button variant="secondary" {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) change(false) }} />
}
