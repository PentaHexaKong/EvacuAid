import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RiDashboardLine, RiRefreshLine } from "@remixicon/react"
import { afterEach, expect, test, vi } from "vitest"
import { MemoryRouter, useLocation } from "react-router"

import { DashboardSidebar, type SidebarItem } from "@/components/application/dashboard/dashboard-sidebar"

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

const items: SidebarItem[] = [
  { label: "Overview", path: "/overview", icon: RiDashboardLine },
  { label: "Assistance", path: "/operations/assistance", icon: RiDashboardLine, badge: 17 },
  { label: "Check-ins", path: "/operations/check-ins", icon: RiDashboardLine },
]

function Path() { return <output aria-label="path">{useLocation().pathname}</output> }

function mount({ path = "/overview", mobile = false, onClose = vi.fn(), onRefresh = vi.fn() } = {}) {
  render(<MemoryRouter initialEntries={[path]}><DashboardSidebar
    items={items}
    secondaryItems={[{ label: "Refresh data", icon: RiRefreshLine, onSelect: onRefresh }, { label: "About this data", path: "/about", icon: RiDashboardLine }]}
    brand={(collapsed) => <span>{collapsed ? "E" : "EvacuAid"}</span>}
    control={(collapsed) => <span>{collapsed ? "control-rail" : "control-full"}</span>}
    mobile={mobile}
    onClose={onClose}
  /><Path /></MemoryRouter>)
  return { sidebar: screen.getByLabelText("Workspace sidebar"), onClose, onRefresh }
}

test("marks the current route and nested routes as the page", () => {
  mount({ path: "/operations/assistance/123" })
  expect(screen.getByRole("link", { name: "Assistance" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current")
  expect(screen.getByText("17")).toBeInTheDocument()
})

test("collapses to a 60px rail, hands the state to its slots, and restores the saved choice", async () => {
  const user = userEvent.setup()
  const { sidebar } = mount()
  expect(sidebar).toHaveClass("w-[260px]")
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
  expect(sidebar).toHaveClass("w-[60px]")
  expect(sidebar).toHaveAttribute("data-collapsed", "true")
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false")
  expect(screen.getByText("control-rail")).toBeInTheDocument()
  expect(localStorage.getItem("evacuaid.command.sidebar-mode")).toBe("Collapsed")
  cleanup()
  expect(mount().sidebar).toHaveClass("w-[60px]")
})

test("still collapses when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable") })
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable") })
  const { sidebar } = mount()
  await userEvent.setup().click(screen.getByRole("button", { name: "Collapse sidebar" }))
  expect(sidebar).toHaveClass("w-[60px]")
})

test("quick search expands the rail, filters both nav groups and opens the first match on Enter", async () => {
  localStorage.setItem("evacuaid.command.sidebar-mode", "Collapsed")
  const user = userEvent.setup()
  const { sidebar } = mount()
  await user.keyboard("{Meta>}l{/Meta}")
  expect(sidebar).toHaveClass("w-[260px]")
  const input = screen.getByRole("searchbox", { name: "Filter navigation" })
  await waitFor(() => { expect(input).toHaveFocus() })
  await user.type(input, "ab")
  expect(within(sidebar).getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual(["About this data"])
  await user.keyboard("{Enter}")
  expect(screen.getByLabelText("path")).toHaveTextContent("/about")
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
})

test("search reports no matches and Escape returns focus to the trigger", async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole("button", { name: "Quick search" }))
  await user.type(screen.getByRole("searchbox"), "zzz")
  expect(screen.getByText("No matching pages")).toBeInTheDocument()
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  await waitFor(() => { expect(screen.getByRole("button", { name: "Quick search" })).toHaveFocus() })
  expect(screen.getAllByRole("link")).toHaveLength(4)
})

test("action rows run their handler instead of navigating", async () => {
  const { onRefresh } = mount()
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh data" }))
  expect(onRefresh).toHaveBeenCalledOnce()
  expect(screen.getByLabelText("path")).toHaveTextContent("/overview")
})

test("the mobile drawer stays expanded, swaps collapse for close, and closes on navigation", async () => {
  localStorage.setItem("evacuaid.command.sidebar-mode", "Collapsed")
  const user = userEvent.setup()
  const { sidebar, onClose } = mount({ mobile: true })
  expect(sidebar).toHaveClass("w-full")
  expect(screen.queryByRole("button", { name: /Collapse sidebar|Expand sidebar/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Close sidebar" }))
  await user.click(screen.getByRole("link", { name: "Check-ins" }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
