import { render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { Notification } from "@/components/base/notification/notification"

test("keeps notification motion still when reduced motion is requested", async () => {
  const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(prefers-reduced-motion)", media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }))
  render(<Notification autoDismissDuration={4000} introDelay={0} title="Changes saved" />)
  const progress = (await screen.findByRole("status")).querySelector(".origin-left")
  await waitFor(() => { expect(progress).toHaveStyle({ transform: "none" }) })
  matchMedia.mockRestore()
})
