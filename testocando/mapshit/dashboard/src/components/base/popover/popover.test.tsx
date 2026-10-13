import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "./popover"

afterEach(cleanup)

test("custom popovers close on page scroll but remain open when their content scrolls", async () => {
  const user = userEvent.setup()
  render(<Popover><PopoverTrigger><button>Open</button></PopoverTrigger><PopoverContent variant="custom"><PopoverTitle>Account</PopoverTitle><div data-testid="scroll-content">Details</div></PopoverContent></Popover>)
  await user.click(screen.getByRole("button", { name: "Open" }))
  fireEvent.scroll(screen.getByTestId("scroll-content"))
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  fireEvent.scroll(document)
  await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument() })
})

test("custom popovers close when their trigger is pressed again", async () => {
  const user = userEvent.setup()
  render(<Popover><PopoverTrigger><button>Open</button></PopoverTrigger><PopoverContent variant="custom"><PopoverTitle>Account</PopoverTitle></PopoverContent></Popover>)
  const trigger = screen.getByRole("button", { name: "Open" })
  await user.click(trigger)
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  await user.click(trigger)
  await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument() })
})

test("custom popovers dismiss on outside pointer presses and preserve inside interaction", async () => {
  const user = userEvent.setup()
  render(<><div data-testid="outside">Outside</div><Popover><PopoverTrigger><button>Open</button></PopoverTrigger><PopoverContent variant="custom"><PopoverTitle>Sidebar control</PopoverTitle><button>Inside</button></PopoverContent></Popover></>)
  await user.click(screen.getByRole("button", { name: "Open" }))
  fireEvent.pointerDown(screen.getByRole("button", { name: "Inside" }))
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByTestId("outside"))
  await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument() })
})
