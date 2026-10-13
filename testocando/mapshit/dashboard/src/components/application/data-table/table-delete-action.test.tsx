import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { TableDeleteAction } from "./table-delete-action"

afterEach(cleanup)

test.each(["Cancel", "Close", "outside click"])("requires confirmation and allows %s dismissal", async (dismiss) => {
  const user = userEvent.setup()
  const remove = vi.fn()
  render(<TableDeleteAction name="Jakarta" onDelete={remove} onDeleted={vi.fn()} />)
  const trigger = screen.getByRole("button", { name: "Delete Jakarta" })
  await user.click(trigger)
  expect(screen.getByRole("alertdialog", { name: "Delete Jakarta?" })).toBeVisible()
  expect(remove).not.toHaveBeenCalled()
  await user.click(dismiss === "outside click" ? document.querySelector('[data-slot="alert-dialog-overlay"]') as HTMLElement : screen.getByRole("button", { name: dismiss }))
  await waitFor(() => { expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument() })
  expect(remove).not.toHaveBeenCalled()
  if (dismiss !== "outside click") await waitFor(() => { expect(trigger).toHaveFocus() })
})

test("locks confirmation while pending and refreshes only after successful closing", async () => {
  const user = userEvent.setup()
  let resolve: () => void = () => undefined
  const remove = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  const refresh = vi.fn(() => Promise.resolve())
  render(<TableDeleteAction name="Jakarta" onDelete={remove} onDeleted={refresh} />)
  await user.click(screen.getByRole("button", { name: "Delete Jakarta" }))
  await user.dblClick(screen.getByRole("button", { name: "Delete" }))
  expect(remove).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled()
  await user.click(document.querySelector('[data-slot="alert-dialog-overlay"]') as HTMLElement)
  expect(screen.getByRole("alertdialog")).toBeVisible()
  await user.keyboard("{Escape}")
  expect(screen.getByRole("alertdialog")).toBeVisible()
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => { resolve(); await Promise.resolve() })
  await waitFor(() => { expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument() })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test("retains failed deletion for retry and respects protected records", async () => {
  const user = userEvent.setup()
  const remove = vi.fn().mockRejectedValueOnce({ status: 409, data: { detail: "This branch is assigned to users." } }).mockResolvedValueOnce({ id: "branch" })
  const refresh = vi.fn(() => Promise.resolve())
  render(<><TableDeleteAction name="Jakarta" onDelete={remove} onDeleted={refresh} /><TableDeleteAction disabled name="Your account" onDelete={remove} onDeleted={refresh} /></>)
  expect(screen.getByRole("button", { name: "Delete Your account" })).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "Delete Jakarta" }))
  await user.click(screen.getByRole("button", { name: "Delete" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("This branch is assigned to users.")
  expect(refresh).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() => { expect(refresh).toHaveBeenCalledTimes(1) })
  expect(remove).toHaveBeenCalledTimes(2)
})
