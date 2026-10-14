import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button, Dialog, Modal } from "react-aria-components"
import { afterEach, expect, test, vi } from "vitest"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../popover/popover"
import { SearchableSelect, Select, SelectItem } from "./select"

afterEach(cleanup)

test("clicking the open trigger closes the dropdown without changing its value", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Select aria-label="Lighting" onChange={onChange} placeholder="Select lighting"><SelectItem id="lit">Lit</SelectItem></Select>)
  const trigger = screen.getByRole("button", { name: /Lighting/ })
  await user.click(trigger)
  expect(await screen.findByRole("listbox")).toBeVisible()
  await user.click(trigger)
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  expect(trigger).toHaveAttribute("aria-expanded", "false")
  await waitFor(() => { expect(trigger).toHaveFocus() })
  expect(onChange).not.toHaveBeenCalled()
  await user.click(trigger)
  await user.click(await screen.findByRole("option", { name: "Lit" }))
  expect(onChange).toHaveBeenCalledWith("lit")
})

test("keyboard opening and Escape dismissal still work", async () => {
  const user = userEvent.setup()
  render(<Select aria-label="Lighting"><SelectItem id="lit">Lit</SelectItem></Select>)
  const trigger = screen.getByRole("button", { name: /Lighting/ })
  trigger.focus()
  await user.keyboard("{ArrowDown}")
  expect(await screen.findByRole("listbox")).toBeVisible()
  await user.keyboard("{Escape}")
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  await waitFor(() => { expect(trigger).toHaveFocus() })
})

const options = [
  { id: "jakarta", label: "Jakarta" },
  { id: "surabaya", label: "Surabaya" },
  { id: "bandung", label: "Bandung" },
  ...Array.from({ length: 4 }, (_, index) => ({ id: "extra" + String(index), label: "Extra " + String(index) })),
]

test("searches long select lists inside the popover", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<SearchableSelect aria-label="Branch" onChange={onChange} options={options} placeholder="Select branch" searchPlaceholder="Search branches" />)

  await user.click(screen.getByRole("button", { name: /Branch/ }))
  const search = await screen.findByRole("searchbox", { name: "Search branches" })
  await user.type(search, "sura")
  expect(screen.queryByRole("option", { name: "Jakarta" })).not.toBeInTheDocument()
  expect(search).toHaveClass("[&::-webkit-search-cancel-button]:hidden")
  expect(search.parentElement?.parentElement?.parentElement).toHaveClass("rounded-lg", "bg-background-secondary-default")
  await user.click(screen.getByRole("button", { name: "Clear search" }))
  expect(search).toHaveValue("")
  expect(screen.getByRole("option", { name: "Jakarta" })).toBeVisible()
  await user.type(search, "sura")
  await user.click(screen.getByRole("option", { name: "Surabaya" }))

  expect(onChange).toHaveBeenCalledWith("surabaya")
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
})

test("retains the selected label while filtering and resets search after Escape", async () => {
  const user = userEvent.setup()
  render(<SearchableSelect aria-label="Branch" defaultValue="jakarta" options={options} />)
  const trigger = screen.getByRole("button", { name: /Branch/ })
  await user.click(trigger)
  await user.type(await screen.findByRole("searchbox"), "missing")
  expect(screen.getByText("No options found.")).toBeVisible()
  expect(trigger).toHaveTextContent("Jakarta")
  await user.keyboard("{Escape}")
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  await user.click(trigger)
  expect(await screen.findByRole("searchbox")).toHaveValue("")
  const selectedOption = screen.getByRole("option", { name: "Jakarta" })
  expect(selectedOption).toBeVisible()
  expect(selectedOption.lastElementChild).toHaveClass("text-accent-600", "dark:text-accent-400")
  expect(selectedOption.querySelector("svg")).toBeInTheDocument()
})

test("vertically centers the selected searchable value", () => {
  render(<SearchableSelect aria-label="Branch" defaultValue="jakarta" options={options} />)

  const value = screen.getByRole("button", { name: /Branch/ }).firstElementChild
  expect(value).toHaveTextContent("Jakarta")
  expect(value?.children).toHaveLength(0)
})

test("selects filtered results with the keyboard and submits the string ID", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { container } = render(<form><SearchableSelect aria-label="Branch" name="branch" isRequired onChange={onChange} options={options} /></form>)
  expect(container.querySelector("select")).toBeRequired()
  await user.click(screen.getByRole("button", { name: /Branch/ }))
  await user.type(await screen.findByRole("searchbox"), "sura")
  await user.keyboard("{ArrowDown}{Enter}")
  expect(onChange).toHaveBeenCalledWith("surabaya")
  const form = container.querySelector("form")
  if (!form) throw new Error("Form is missing")
  expect(new FormData(form).get("branch")).toBe("surabaya")
})

test("preserves disabled and invalid semantics", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(<SearchableSelect aria-label="Branch" isDisabled options={options} />)
  expect(screen.getByRole("button", { name: /Branch/ })).toBeDisabled()
  rerender(<SearchableSelect aria-label="Branch" isInvalid onChange={onChange} options={[{ id: "jakarta", label: "Jakarta", isDisabled: true }]} />)
  const trigger = screen.getByRole("button", { name: /Branch/ })
  expect(trigger).toHaveClass("border-border-error", "bg-background-tertiary-error")
  await user.click(trigger)
  const option = await screen.findByRole("option", { name: "Jakarta" })
  expect(option).toHaveAttribute("aria-disabled", "true")
  await user.click(option)
  expect(onChange).not.toHaveBeenCalled()
})

test("Escape closes the searchable popup without dismissing its parent modal", async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  render(<Modal isOpen isDismissable onOpenChange={onOpenChange}><Dialog aria-label="Edit branch"><SearchableSelect aria-label="Branch" options={options} /></Dialog></Modal>)
  const trigger = screen.getByRole("button", { name: /Branch/ })
  await user.click(trigger)
  await user.type(await screen.findByRole("searchbox"), "sura")
  await user.keyboard("{Escape}")
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  expect(screen.getByRole("dialog", { name: "Edit branch" })).toBeVisible()
  expect(onOpenChange).not.toHaveBeenCalled()
  await waitFor(() => { expect(trigger).toHaveFocus() })
})

test.each([0, 6, 7])("search appears only above six options (%i)", async (count) => {
  const user = userEvent.setup()
  render(<SearchableSelect aria-label="Count" options={Array.from({ length: count }, (_, index) => ({ id: String(index), label: String(index) }))} />)
  await user.click(screen.getByRole("button", { name: /Count/ }))
  expect(screen.queryByRole("searchbox") !== null).toBe(count > 6)
})

test("scroll outside closes while list scroll retains the selection", async () => {
  const user = userEvent.setup()
  render(<SearchableSelect aria-label="Branch" options={options} defaultValue="jakarta" />)
  const trigger = screen.getByRole("button", { name: /Branch/ })
  await user.click(trigger)
  screen.getByRole("listbox").dispatchEvent(new Event("scroll"))
  expect(screen.getByRole("listbox")).toBeVisible()
  document.dispatchEvent(new Event("scroll"))
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  expect(trigger).toHaveTextContent("Jakarta")
})

test("async options enable search without losing an existing selection", async () => {
  const user = userEvent.setup()
  const { rerender } = render(<SearchableSelect aria-label="Branch" value="jakarta" options={options.slice(0, 6)} />)
  await user.click(screen.getByRole("button", { name: /Branch/ }))
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  rerender(<SearchableSelect aria-label="Branch" value="jakarta" options={options} />)
  expect(await screen.findByRole("searchbox")).toBeVisible()
  expect(screen.getByRole("button", { name: /Branch/ })).toHaveTextContent("Jakarta")
})

test("nested selects dismiss siblings and close on the panel background", async () => {
  const user = userEvent.setup()
  render(<Popover><PopoverTrigger><Button>Filter</Button></PopoverTrigger><PopoverContent><PopoverTitle>Filters</PopoverTitle><Select aria-label="Status"><SelectItem id="active">Active</SelectItem></Select><SearchableSelect aria-label="City" options={options} /></PopoverContent></Popover>)
  await user.click(screen.getByRole("button", { name: "Filter" }))
  await user.click(screen.getByRole("button", { name: /Status/ }))
  expect(await screen.findByRole("listbox")).toBeVisible()
  await user.click(screen.getByRole("button", { name: /City/ }))
  expect(await screen.findByRole("searchbox")).toBeVisible()
  expect(screen.getAllByRole("listbox")).toHaveLength(1)
  fireEvent.scroll(screen.getByRole("dialog", { name: "Filters" }))
  expect(screen.getByRole("listbox")).toBeVisible()
  await user.click(screen.getByRole("heading", { name: "Filters" }))
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  expect(screen.getByRole("dialog")).toBeVisible()
})

test.each([0, 1, 6])("alwaysSearchable permits searching %i options", async (count) => {
  const user = userEvent.setup()
  render(<SearchableSelect alwaysSearchable aria-label="Category" options={Array.from({ length: count }, (_, index) => ({ id: String(index), label: String(index) }))} />)
  await user.click(screen.getByRole("button", { name: /Category/ }))
  expect(await screen.findByRole("searchbox")).toBeVisible()
})

test("creatable action trims names, excludes matching options and prevents duplicate requests", async () => {
  const user = userEvent.setup()
  let resolve: () => void = () => {}
  const onCreate = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  render(<SearchableSelect aria-label="Category" options={[{ id: "existing", label: "Existing" }]} creatable={{ getLabel: (query) => `Add ${query}`, onCreate }} />)
  await user.click(screen.getByRole("button", { name: /Category/ }))
  const search = await screen.findByRole("searchbox")
  await user.type(search, " EXISTING ")
  expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, " New category ")
  const create = screen.getByRole("button", { name: "Add New category" })
  await user.dblClick(create)
  expect(onCreate).toHaveBeenCalledExactlyOnceWith("New category")
  expect(create).toBeDisabled()
  resolve()
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  await waitFor(() => { expect(screen.getByRole("button", { name: /Category/ })).toHaveFocus() })
})

test("creatable failure retains the query for keyboard retry", async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn().mockRejectedValueOnce(new Error("Could not save. Try again.")).mockResolvedValue(undefined)
  render(<SearchableSelect aria-label="Category" options={[]} creatable={{ getLabel: (query) => `Add ${query}`, onCreate }} />)
  await user.click(screen.getByRole("button", { name: /Category/ }))
  await user.type(await screen.findByRole("searchbox"), "New category")
  await user.click(screen.getByRole("button", { name: "Add New category" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again")
  expect(screen.getByRole("searchbox")).toHaveValue("New category")
  screen.getByRole("button", { name: "Add New category" }).focus()
  await user.keyboard("{Enter}")
  await waitFor(() => { expect(screen.queryByRole("listbox")).not.toBeInTheDocument() })
  expect(onCreate).toHaveBeenCalledTimes(2)
})


test("creation can insert and select the server ID without exposing a placeholder option", async () => {
  function Example() {
    const [items, setItems] = useState<{ id: string; label: string }[]>([])
    const [value, setValue] = useState<string | null>(null)
    return <SearchableSelect aria-label="Category" options={items} value={value} onChange={setValue} creatable={{ getLabel: (query) => `Add ${query}`, onCreate: (query) => { setItems([{ id: "server-id", label: query }]); setValue("server-id"); return Promise.resolve() } }} />
  }
  const user = userEvent.setup()
  render(<Example />)
  await user.click(screen.getByRole("button", { name: /Category/ }))
  expect(screen.getByRole("option", { name: "No options found." })).toHaveAttribute("aria-disabled", "true")
  await user.type(screen.getByRole("searchbox"), "New category")
  await user.click(screen.getByRole("button", { name: "Add New category" }))
  await waitFor(() => { expect(screen.getByRole("button", { name: /Category/ })).toHaveTextContent("New category") })
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
})
