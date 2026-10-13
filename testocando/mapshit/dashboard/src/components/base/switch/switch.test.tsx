import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test } from "vitest"

import { Switch } from "@/components/base/switch/switch"

test("renders and toggles the BoardUI switch recipe", () => {
  render(<Switch defaultSelected>Email notifications</Switch>)

  const control = screen.getByRole("switch", { name: "Email notifications" })
  const track = screen.getByText("Email notifications").parentElement?.querySelector("[aria-hidden]")
  expect(control).toBeChecked()
  expect(track).toHaveClass("h-6", "w-[42px]", "rounded-full", "from-accent-500", "to-accent-600")

  fireEvent.click(control)
  expect(control).not.toBeChecked()
  expect(track).toHaveClass("bg-background-tertiary-default")
})
