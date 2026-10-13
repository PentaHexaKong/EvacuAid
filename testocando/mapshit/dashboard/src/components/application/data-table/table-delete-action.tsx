import { useRef, useState } from "react"
import { RiDeleteBinLine } from "@remixicon/react"

import { notification } from "@/components/app/notification-store"
import { TableActionButton } from "@/components/application/data-table/table-action-button"
import { AlertDialog, AlertDialogBody, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/base/dialog/alert-dialog"
import { Button } from "@/components/base/buttons/button"

export function TableDeleteAction({ name, onDelete, onDeleted, disabled = false, description = "This permanently deletes this record. Records that are still in use cannot be deleted." }: { name: string; onDelete: () => Promise<unknown>; onDeleted: () => Promise<unknown>; disabled?: boolean; description?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const pending = useRef(false)
  const deleted = useRef(false)
  const trigger = useRef<HTMLButtonElement | null>(null)

  async function remove() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError("")
    try {
      const result = await onDelete()
      deleted.current = true
      setOpen(false)
      // Endpoints that soft-delete in-use records answer { archived: true } or { result: "archived" }.
      if (result && typeof result === "object" && ("archived" in result && result.archived === true || "result" in result && result.result === "archived")) notification.success("Record archived", `${name} is still in use, so it was archived instead of deleted.`)
      else notification.success("Record deleted", `${name} was deleted.`)
    } catch (cause) {
      const data = cause && typeof cause === "object" && "data" in cause ? cause.data : undefined
      setError(data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : "Could not delete this record. Please try again.")
    } finally { pending.current = false; setBusy(false) }
  }

  async function closed() {
    setError("")
    if (!deleted.current) return
    deleted.current = false
    const page = trigger.current?.closest("section")?.parentElement
    try { await onDeleted() }
    catch { notification.error("Could not refresh the table", "The record was deleted. Reload the page to see the latest records.") }
    page?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus()
  }

  return <AlertDialog open={open} onOpenChange={(value, details) => { if (pending.current) details.cancel(); else setOpen(value) }} onOpenChangeComplete={(value) => { if (!value && !open) void closed() }}>
    <TableActionButton onClick={() => { setOpen(true) }} aria-label={`Delete ${name}`} disabled={disabled} iconOnly leadingIcon={RiDeleteBinLine} ref={trigger} size="small" variant="secondary" />
    <AlertDialogContent aria-busy={busy}>
      <AlertDialogBody><AlertDialogHeader closeDisabled={busy}><AlertDialogTitle className="break-words [overflow-wrap:anywhere]">Delete {name}?</AlertDialogTitle></AlertDialogHeader>
      <AlertDialogDescription>{description}</AlertDialogDescription>
      {error && <p className="text-body-regular text-destructive" role="alert">{error}</p>}</AlertDialogBody>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} size="medium">Cancel</AlertDialogCancel><Button disabled={busy} loading={busy} onClick={() => { void remove() }} variant="danger">Delete</Button></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
