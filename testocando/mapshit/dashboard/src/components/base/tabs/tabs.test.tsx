import { createRef } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { Tab, TabList, Tabs } from "./tabs"

afterEach(() => { cleanup(); vi.restoreAllMocks() })

test("retains the underline origin when route content remounts", async () => {
  const position = createRef<{ left: number; width: number } | null>()
  position.current = { left: 12, width: 90 }
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(120)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100)
  const { container } = render(<Tabs selectedKey="second"><TabList aria-label="Sections" underlinePositionRef={position}><Tab id="first">First</Tab><Tab id="second">Second</Tab></TabList></Tabs>)
  const underline = container.querySelector('span[aria-hidden]')
  expect(underline).toHaveStyle({ transform: "translateX(12px)", width: "90px" })
  expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "true")
  await waitFor(() => { expect(underline).toHaveStyle({ transform: "translateX(120px)", width: "100px" }) })
  expect(position.current).toEqual({ left: 120, width: 100 })
})
