import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/base/tooltip/tooltip"

afterEach(cleanup)

async function findTooltipContent() {
  let tooltip: Element | undefined
  await waitFor(() => {
    tooltip = [...document.querySelectorAll('[data-slot="tooltip-content"]')].at(-1)
    expect(tooltip).toBeInTheDocument()
  })
  if (!tooltip) throw new Error("Tooltip content is missing")
  return tooltip
}

test("renders the BoardUI tooltip shell without an arrow", async () => {
  const user = userEvent.setup()
  render(<TooltipProvider><Tooltip><TooltipTrigger><button>Help</button></TooltipTrigger><TooltipContent side="right">Helpful text</TooltipContent></Tooltip></TooltipProvider>)

  await user.hover(document.body)
  await user.hover(screen.getByRole("button", { name: "Help" }))

  const tooltip = await findTooltipContent()
  expect(tooltip).toHaveAttribute("data-size", "sm")
  expect(tooltip).toHaveClass("max-w-[240px]", "rounded-lg", "bg-background-primary-default", "text-caption-1-medium")
  expect(tooltip.querySelector('[data-slot="tooltip-arrow"]')).not.toBeInTheDocument()
})

test("supports the medium size", async () => {
  const user = userEvent.setup()
  render(<TooltipProvider><Tooltip><TooltipTrigger><button>Details</button></TooltipTrigger><TooltipContent size="md">More details</TooltipContent></Tooltip></TooltipProvider>)

  await user.hover(screen.getByRole("button", { name: "Details" }))

  const tooltip = await findTooltipContent()
  expect(tooltip).toHaveAttribute("data-size", "md")
  expect(tooltip).toHaveClass("px-3", "py-2", "text-body-medium")
})

test("opens on keyboard focus and dismisses with Escape", async () => {
  const user = userEvent.setup()
  render(<Tooltip><TooltipTrigger><button>Keyboard help</button></TooltipTrigger><TooltipContent>Helpful text</TooltipContent></Tooltip>)
  await user.tab()
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Helpful text")
  await user.keyboard("{Escape}")
  await waitFor(() => { expect(screen.queryByRole("tooltip")).not.toBeInTheDocument() })
  expect(screen.getByRole("button", { name: "Keyboard help" })).toHaveFocus()
})
