import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RiDashboardLine as IconLayoutDashboard } from "@remixicon/react"
import { afterEach, expect, test, vi } from "vitest"
import { MemoryRouter } from "react-router"

import { DashboardSidebar } from "@/components/application/dashboard/dashboard-sidebar"

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

const company = { id: "aka", name: "Aneka Karya Advertising" }
const dashboard = { label: "Dashboard", path: "/dashboard", icon: IconLayoutDashboard }
const users = { label: "Users", path: "/settings/users", icon: IconLayoutDashboard }
const groups = [{ label: "Settings", icon: IconLayoutDashboard, items: [users] }]

function sidebar(overrides: Partial<Parameters<typeof DashboardSidebar>[0]> = {}) {
  return <DashboardSidebar
    companies={[company]}
    companyId="aka"
    navigation={[dashboard]}
    navigationGroups={groups}
    onCompanyChange={() => Promise.resolve()}
    {...overrides}
  />
}

async function expectTooltip(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, label: string) {
  await user.hover(trigger)
  let tooltip: Element | undefined
  await waitFor(() => {
    tooltip = [...document.querySelectorAll('[data-slot="tooltip-content"]')].at(-1)
    expect(tooltip).toHaveTextContent(label)
  })
  await user.unhover(trigger)
  await waitFor(() => { expect(tooltip).not.toBeInTheDocument() })
}

test("switches company from the rail popover", async () => {
  const user = userEvent.setup()
  const onCompanyChange = vi.fn(() => Promise.resolve())
  render(<MemoryRouter>{sidebar({ companies: [company, { id: "akp", name: "Aneka Karya Perdana" }], onCompanyChange })}</MemoryRouter>)

  await user.click(screen.getByRole("button", { name: "Open company menu for Aneka Karya Advertising" }))
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aneka Karya Perdana" }))
  expect(onCompanyChange).toHaveBeenCalledWith("akp")

  expect(screen.queryByRole("button", { name: /Open account menu/ })).not.toBeInTheDocument()
})

test("renders a fixed icon rail with forty-pixel controls and contextual tooltips", async () => {
  localStorage.setItem("enterprisehub.sidebar-mode", "Collapsed")
  const user = userEvent.setup()
  render(<MemoryRouter>{sidebar()}</MemoryRouter>)

  const workspace = screen.getByLabelText("Workspace sidebar")
  expect(workspace.querySelector('[data-slot="sidebar-rail"]')).toHaveClass("w-[60px]")
  expect(within(workspace).getByRole("button", { name: "Sidebar control" })).toBeInTheDocument()

  const dashboardLink = within(workspace).getByRole("link", { name: "Dashboard" })
  const settingsButton = within(workspace).getByRole("button", { name: "Settings" })
  const companyButton = within(workspace).getByRole("button", { name: "Open company menu for Aneka Karya Advertising" })
  expect(dashboardLink).toHaveClass("h-10", "w-full")
  expect(settingsButton).toHaveClass("h-10", "w-full")
  expect(companyButton).toHaveClass("h-10", "w-full")
  await expectTooltip(user, dashboardLink, "Dashboard")
  await expectTooltip(user, settingsButton, "Settings")
  await expectTooltip(user, companyButton, "Aneka Karya Advertising")
})

test("opens a secondary panel from a grouped module and closes it for direct navigation", async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={["/dashboard"]}>{sidebar()}</MemoryRouter>)

  const settingsButton = screen.getByRole("button", { name: "Settings" })
  expect(settingsButton).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByLabelText("Settings navigation")).not.toBeInTheDocument()

  await user.click(settingsButton)
  expect(settingsButton).toHaveAttribute("aria-expanded", "true")
  expect(screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')).toHaveClass("w-[240px]")
  expect(screen.getByLabelText("Settings navigation")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page")

  await user.click(screen.getByRole("link", { name: "Dashboard" }))
  expect(settingsButton).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByLabelText("Settings navigation")).not.toBeInTheDocument()
})

test("opens the matching panel for a child route and uses the main sidebar gradient selection", () => {
  render(<MemoryRouter initialEntries={["/settings/users"]}>{sidebar()}</MemoryRouter>)

  const settingsButton = screen.getByRole("button", { name: "Settings" })
  const usersLink = screen.getByRole("link", { name: "Users" })
  expect(settingsButton).toHaveAttribute("aria-expanded", "true")
  expect(settingsButton.getAttribute("aria-controls")).toBe(screen.getByLabelText("Settings navigation").id)
  expect(usersLink).toHaveAttribute("aria-current", "page")
  expect(usersLink).toHaveClass("bg-linear-to-b", "from-accent-500", "to-accent-600", "text-text-white", "shadow-nav-selected")
})

test("removes a selected panel when its group becomes unavailable", async () => {
  const { rerender } = render(<MemoryRouter>{sidebar()}</MemoryRouter>)
  await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }))
  expect(screen.getByLabelText("Settings navigation")).toBeInTheDocument()

  rerender(<MemoryRouter>{sidebar({ navigationGroups: [] })}</MemoryRouter>)
  await waitFor(() => { expect(screen.queryByLabelText("Settings navigation")).not.toBeInTheDocument() })
})

test("uses the selected company's avatar color in the rail", () => {
  localStorage.setItem("enterprisehub.sidebar-mode", "Collapsed")
  render(<MemoryRouter>{sidebar({ companies: [company, { id: "akp", name: "Aneka Karya Perdana" }], companyId: "akp" })}</MemoryRouter>)
  const trigger = screen.getByRole("button", { name: "Open company menu for Aneka Karya Perdana" })
  expect(trigger.firstElementChild).toHaveClass("size-8", "rounded-full", "bg-lime-200", "text-lime-700")
})

test.each(["single", "two"] as const)("preserves the mobile drawer without sidebar controls in %s layout", async (layout) => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<MemoryRouter initialEntries={["/settings/users"]}>{sidebar({ mobile: true, layout, onClose })}</MemoryRouter>)

  const workspace = screen.getByLabelText("Workspace sidebar")
  expect(workspace).toHaveClass("w-full")
  expect(within(workspace).queryByRole("button", { name: "Sidebar control" })).not.toBeInTheDocument()
  expect(within(workspace).queryByRole("button", { name: /Open account menu/ })).not.toBeInTheDocument()
  expect(within(workspace).getByRole("button", { name: "Close sidebar" })).toHaveClass("size-11")
  expect(within(workspace).getByRole("button", { name: "Settings" })).toHaveAttribute("aria-expanded", "true")
  expect(within(workspace).getByRole("list", { name: "Settings" })).toBeInTheDocument()
  expect(within(workspace).queryByLabelText("Settings navigation")).not.toBeInTheDocument()

  await user.click(within(workspace).getByRole("link", { name: "Users" }))
  expect(onClose).toHaveBeenCalledOnce()
})

test.each([false, true])("uses a continuous mobile tree and desktop section dividers (mobile=%s)", (mobile) => {
  const items = [
    { label: "Companies", path: "/data-master/company", icon: IconLayoutDashboard, section: "Business records" },
    { label: "Employees", path: "/data-master/employee", icon: IconLayoutDashboard, section: "Employees" },
    { label: "Employee Types", path: "/data-master/employee-types", icon: IconLayoutDashboard, section: "Employees" },
    { label: "Vehicles", path: "/data-master/vehicles", icon: IconLayoutDashboard, section: "Vehicles" },
    { label: "Promotion Materials", path: "/data-master/promotion-materials", icon: IconLayoutDashboard, section: "Promotion" },
  ]
  render(<MemoryRouter initialEntries={["/data-master/employee-types"]}>{sidebar({ mobile, navigationGroups: [{ label: "Data Master", icon: IconLayoutDashboard, items }] })}</MemoryRouter>)
  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument()
  expect(screen.queryAllByRole("separator")).toHaveLength(mobile ? 0 : 3)
  if (mobile) {
    const tree = screen.getByRole("list", { name: "Data Master" })
    expect(within(tree).getAllByRole("link").map((link) => link.textContent)).toEqual(items.map((item) => item.label))
    for (const item of within(tree).getAllByRole("listitem")) {
      expect(item.querySelectorAll('span[aria-hidden].border-l')).toHaveLength(2)
    }
  }
  expect(screen.getByRole("link", { name: "Employee Types" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "Employees" })).not.toHaveAttribute("aria-current")
  expect(screen.queryByRole("button", { name: "Promotion" })).not.toBeInTheDocument()
})

test("does not render headings for filtered-out sections", () => {
  render(<MemoryRouter initialEntries={["/data-master/client"]}>{sidebar({ navigationGroups: [{ label: "Data Master", icon: IconLayoutDashboard, items: [{ label: "Clients", path: "/data-master/client", icon: IconLayoutDashboard }] }] })}</MemoryRouter>)
  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument()
})


test.each([
  ["Data Master", "/data-master/branch", "/data-master/client"],
  ["Settings", "/settings/notifications", "/settings/users"],
  ["Reports", "/reports/overview", "/reports/activity"],
])("opening %s navigates to its first available submodule", async (label, firstPath, secondPath) => {
  const user = userEvent.setup()
  const items = [
    { label: "First available", path: firstPath, icon: IconLayoutDashboard },
    { label: "Second", path: secondPath, icon: IconLayoutDashboard },
  ]
  render(<MemoryRouter initialEntries={[secondPath]}>{sidebar({ navigationGroups: [{ label, icon: IconLayoutDashboard, items }] })}</MemoryRouter>)
  expect(screen.getByRole("link", { name: "Second" })).toHaveAttribute("aria-current", "page")
  screen.getByRole("button", { name: label }).focus()
  await user.keyboard("{Enter}")
  expect(screen.getByRole("link", { name: "First available" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "Second" })).not.toHaveAttribute("aria-current")
})

test.each([null, "invalid"])("defaults to expanded with a missing or invalid preference (%s)", (saved) => {
  if (saved) localStorage.setItem("enterprisehub.sidebar-mode", saved)
  render(<MemoryRouter>{sidebar()}</MemoryRouter>)
  const rail = screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')
  if (!rail) throw new Error("Sidebar rail is missing")
  expect(rail).toHaveAttribute("data-expanded", "true")
  expect(rail.parentElement).toHaveClass("w-[240px]")
  expect(screen.getByRole("button", { name: "Settings" })).toHaveTextContent("Settings")
})

test("selects and restores all three modes", async () => {
  const user = userEvent.setup()
  for (const mode of ["Collapsed", "Expand on hover", "Expanded"]) {
    const { unmount } = render(<MemoryRouter>{sidebar()}</MemoryRouter>)
    await user.click(screen.getByRole("button", { name: "Sidebar control" }))
  await user.click(screen.getByRole("button", { name: "Sidebar display" }))
    await user.click(screen.getByRole("radio", { name: mode }))
    expect(screen.getByRole("radio", { name: mode })).toBeChecked()
    expect(localStorage.getItem("enterprisehub.sidebar-mode")).toBe(mode)
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    unmount()
    const restored = render(<MemoryRouter>{sidebar()}</MemoryRouter>)
    const rail = screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')
    if (!rail) throw new Error("Sidebar rail is missing")
    expect(rail.parentElement).toHaveClass(mode === "Expanded" ? "w-[240px]" : "w-[60px]")
    expect(rail).toHaveAttribute("data-expanded", String(mode === "Expanded"))
    restored.unmount()
  }
})

test("still switches modes when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable") })
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable") })
  const user = userEvent.setup()
  render(<MemoryRouter>{sidebar()}</MemoryRouter>)
  const rail = screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')
  if (!rail) throw new Error("Sidebar rail is missing")
  expect(rail).toHaveAttribute("data-expanded", "true")
  await user.click(screen.getByRole("button", { name: "Sidebar control" }))
  await user.click(screen.getByRole("button", { name: "Sidebar display" }))
  await user.click(screen.getByRole("radio", { name: "Collapsed" }))
  expect(rail).toHaveAttribute("data-expanded", "false")
})

test("hover and focus reveal labels without changing reserved space or replacing focused links", async () => {
  localStorage.setItem("enterprisehub.sidebar-mode", "Expand on hover")
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={["/settings/users"]}>{sidebar()}</MemoryRouter>)
  const rail = screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')
  if (!rail) throw new Error("Sidebar rail is missing")
  const link = screen.getByRole("link", { name: "Dashboard" })
  await user.hover(link)
  expect(rail).toHaveAttribute("data-expanded", "true")
  expect(rail.parentElement).toHaveClass("w-[60px]")
  await user.unhover(link)
  expect(rail).toHaveAttribute("data-expanded", "false")
  fireEvent.keyDown(rail, { key: "Tab" })
  fireEvent.focusIn(link)
  expect(rail).toHaveAttribute("data-expanded", "true")
  expect(screen.getByRole("link", { name: "Dashboard" })).toBe(link)
  fireEvent.focusOut(link, { relatedTarget: screen.getByRole("link", { name: "Users" }) })
  expect(rail).toHaveAttribute("data-expanded", "false")
  await user.hover(screen.getByLabelText("Settings navigation"))
  expect(rail).toHaveAttribute("data-expanded", "false")
})

test.each(["Sidebar control", "Open company menu for Aneka Karya Advertising"])("collapses outside the rail while keeping %s open", async (name) => {
  localStorage.setItem("enterprisehub.sidebar-mode", "Expand on hover")
  const user = userEvent.setup()
  render(<MemoryRouter>{sidebar()}</MemoryRouter>)
  const rail = screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')
  if (!rail) throw new Error("Sidebar rail is missing")
  const trigger = screen.getByRole("button", { name })
  await user.click(trigger)
  await user.hover(screen.getByRole("dialog"))
  expect(rail).toHaveAttribute("data-expanded", "false")
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.focusOut(trigger, { relatedTarget: document.body })
  fireEvent.pointerOut(rail)
  expect(rail).toHaveAttribute("data-expanded", "false")
})

test.each(["Expanded", "Expand on hover"])("dismisses sidebar control outside and supports BoardUI keyboard selection in %s mode", async (mode) => {
  localStorage.setItem("enterprisehub.sidebar-mode", mode)
  const user = userEvent.setup()
  render(<MemoryRouter><button>Outside</button>{sidebar()}</MemoryRouter>)
  const control = screen.getByRole("button", { name: "Sidebar control" })
  await user.click(control)
  await user.click(screen.getByRole("button", { name: "Sidebar display" }))
  await user.click(screen.getByRole("radio", { name: "Expanded" }))
  await user.keyboard("{ArrowDown}")
  expect(screen.getByRole("radio", { name: "Collapsed" })).toBeChecked()
  expect(localStorage.getItem("enterprisehub.sidebar-mode")).toBe("Collapsed")
  await user.click(screen.getByRole("button", { name: "Outside" }))
  await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument() })
})

test("single sidebar keeps labels expanded and toggles groups without navigating", async () => {
  localStorage.setItem("enterprisehub.sidebar-mode", "Expanded")
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={["/dashboard"]}>{sidebar({ layout: "single" })}</MemoryRouter>)
  expect(screen.getByRole("button", { name: "Sidebar control" })).toBeInTheDocument()
  expect(screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')).toHaveClass("w-[240px]")
  await user.click(screen.getByRole("button", { name: "Settings" }))
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
  await user.click(screen.getByRole("link", { name: "Users" }))
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page")
  expect(screen.queryByLabelText("Settings navigation")).not.toBeInTheDocument()
  expect(localStorage.getItem("enterprisehub.sidebar-mode")).toBe("Expanded")
})

 test("single-sidebar controls collapse the rail and group clicks restore its labels", async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={["/dashboard"]}>{sidebar({ layout: "single" })}</MemoryRouter>)
  await user.click(screen.getByRole("button", { name: "Sidebar control" }))
  await user.click(screen.getByRole("button", { name: "Sidebar display" }))
  await user.click(screen.getByRole("radio", { name: "Collapsed" }))
  await user.keyboard("{Escape}")
  expect(screen.getByLabelText("Workspace sidebar").querySelector('[data-slot="sidebar-rail"]')).toHaveAttribute("data-expanded", "false")
  await user.click(screen.getByRole("button", { name: "Settings" }))
  expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
  expect(localStorage.getItem("enterprisehub.sidebar-mode")).toBe("Expanded")
 })
