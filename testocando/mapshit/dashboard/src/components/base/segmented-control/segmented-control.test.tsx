import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { SegmentedControl, SegmentedControlItem } from "./segmented-control"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("positions the selected thumb from layout geometry inside a scaled parent", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-selected")) return { bottom: 134.2, height: 30.4, left: 103.8, right: 198.8, top: 103.8, width: 95, x: 103.8, y: 103.8, toJSON: () => ({}) }
    return { bottom: 138, height: 38, left: 100, right: 385, top: 100, width: 285, x: 100, y: 100, toJSON: () => ({}) }
  })
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-selected") ? 4 : 0 })
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-selected") ? 4 : 0 })
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-selected") ? 100 : 300 })
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-selected") ? 32 : 40 })

  render(<SegmentedControl aria-label="Notifications" selectedKeys={["all"]}><SegmentedControlItem id="all">All</SegmentedControlItem><SegmentedControlItem id="mentions">Mentions</SegmentedControlItem></SegmentedControl>)

  const thumb = screen.getByRole("radiogroup", { name: "Notifications" }).querySelector<HTMLElement>("[aria-hidden]")
  expect(thumb).toHaveStyle({ height: "32px", transform: "translate(4px, 4px)", width: "100px" })
})
