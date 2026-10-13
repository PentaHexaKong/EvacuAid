import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { Button } from "./button"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

afterEach(cleanup)

test("icon-only controls retain their size beside long text", () => {
  render(<div className="flex"><Button aria-label="Show details" iconOnly size="xs" /><span>{"Long entry".repeat(30)}</span></div>)
  expect(screen.getByRole("button", { name: "Show details" })).toHaveClass("shrink-0", "size-6")
})

test("loading preserves the label and blocks duplicate submission", async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  const { rerender } = render(<Button type="submit" loading onClick={onClick}>Save</Button>)
  const button = screen.getByRole("button", { name: "Save" })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute("aria-busy", "true")
  expect(button).toHaveAttribute("type", "submit")
  await user.click(button)
  expect(onClick).not.toHaveBeenCalled()
  rerender(<Button onClick={onClick}>Save</Button>)
  expect(button).not.toHaveAttribute("aria-busy")
  await user.click(button)
  expect(onClick).toHaveBeenCalledOnce()
})

test("click focuses the button before opening an overlay", () => {
  const onClick = vi.fn(() => { expect(screen.getByRole("button", { name: "Open" })).toHaveFocus() })
  render(<Button onClick={onClick}>Open</Button>)
  fireEvent.click(screen.getByRole("button", { name: "Open" }))
  expect(onClick).toHaveBeenCalledOnce()
})
