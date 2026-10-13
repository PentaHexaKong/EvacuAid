import { RiEditLine } from "@remixicon/react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test } from "vitest"

import { TableActionButton } from "./table-action-button"

test("shows the action label in a tooltip", async () => {
  const user = userEvent.setup()
  render(<TableActionButton aria-label="Edit record" iconOnly leadingIcon={RiEditLine} />)

  fireEvent.pointerMove(document.body, { pointerType: "mouse" })
  await user.hover(screen.getByRole("button", { name: "Edit record" }))

  await waitFor(() => {
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent("Edit record")
  })
})
