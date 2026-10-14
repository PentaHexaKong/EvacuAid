import { RiFlaskLine, RiInformationLine, RiMenuLine, RiRefreshLine, RiSignalTowerLine } from "@remixicon/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Link, useLocation } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/base/buttons/button"
import { Avatar } from "@/components/base/avatar/avatar"
import { MobileNavigation } from "@/components/app/MobileNavigation"
import { Collapsible, DashboardSidebar, SidebarTooltip, type SidebarItem } from "@/components/application/dashboard/dashboard-sidebar"
import { navigation } from "@/app/nav"
import { useAssistanceCounts, useConnectionStatus } from "@/lib/queries"
import { useDataMode } from "@/app/data-mode"
import { cx } from "@/utils/cx"

const ease = "duration-300 ease-in-out motion-reduce:transition-none"

function Brand({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return <Link to="/overview" aria-label="EvacuAid command center" onClick={onNavigate} className="relative flex min-w-0 items-center gap-2 rounded-full outline-none before:pointer-events-none before:absolute before:-inset-x-1.5 before:-inset-y-[5px] before:rounded-full before:border-2 before:border-transparent before:transition-colors before:duration-150 hover:before:border-border-sidebar-profile-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2">
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-accent-500 to-accent-600 text-headline-semibold text-white shadow-nav-selected">E</span>
    <Collapsible collapsed={collapsed}><span className="text-body-medium whitespace-nowrap text-text-primary">EvacuAid</span></Collapsible>
  </Link>
}

const environments = [
  { mode: "REFERENCE", label: "Operational", icon: RiSignalTowerLine },
  { mode: "SIMULATION", label: "Simulation", icon: RiFlaskLine },
] as const

/** Sits in BoardUI's theme-toggle slot: a segmented pill expanded, one icon button on the rail. */
function DataEnvironment({ collapsed }: { collapsed: boolean }) {
  const { dataMode, setDataMode } = useDataMode()
  const simulation = dataMode === "SIMULATION"
  if (collapsed) {
    const current = environments[simulation ? 1 : 0]
    const label = `${current.label} data. Switch to ${simulation ? "operational" : "simulation"} data`
    return <SidebarTooltip label={label} show><button
      type="button"
      aria-label={label}
      aria-pressed={simulation}
      onClick={() => { setDataMode(simulation ? "REFERENCE" : "SIMULATION") }}
      className={cx("flex size-9 cursor-pointer items-center justify-center rounded-2lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring", simulation ? "bg-status-yellow-background text-status-yellow-text" : "text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary")}
    ><current.icon className="size-5" aria-hidden /></button></SidebarTooltip>
  }
  return <div role="group" aria-label="Data environment" className="relative grid w-full grid-cols-2 gap-1 rounded-full bg-theme-toggle-sidebar-background p-1">
    <span aria-hidden className={cx("pointer-events-none absolute inset-y-1 start-1 w-[calc(50%-6px)] rounded-full bg-theme-toggle-sidebar-selected-background shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none", simulation && "translate-x-[calc(100%+4px)]")} />
    {environments.map(({ mode, label, icon: Icon }) => {
      const selected = dataMode === mode
      return <button
        key={mode}
        type="button"
        aria-pressed={selected}
        onClick={() => { setDataMode(mode) }}
        className={cx("relative z-10 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full text-body-2-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring", selected ? "text-text-primary" : "text-text-secondary hover:text-text-primary")}
      ><Icon className={cx("size-4", selected && mode === "SIMULATION" ? "text-status-yellow-text" : selected ? "text-foreground-icon-primary" : "text-foreground-icon-secondary")} aria-hidden />{label}</button>
    })}
  </div>
}

/** BoardUI's team card slot: the region in scope and the live connection state. */
function WorkspaceCard({ collapsed }: { collapsed: boolean }) {
  const connection = useConnectionStatus()
  const announcement = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = announcement.current
    if (node && (!node.textContent || connection.tone !== "loading") && node.textContent !== connection.text) node.textContent = connection.text
  }, [connection.text, connection.tone])
  const dot = { loading: "bg-neutral-400", connected: "bg-green-500", error: "bg-red-500" }[connection.tone]
  return <div
    title={collapsed ? `DKI Jakarta · ${connection.text}` : undefined}
    className={cx("flex items-center overflow-hidden border-2 border-transparent transition-[width,background-color,padding]", ease, collapsed ? "size-9 rounded-full bg-transparent p-0" : "w-full rounded-xl bg-background-tertiary-default py-2 pe-3 ps-2.5")}
  >
    <span className="relative shrink-0">
      <Avatar aria-hidden initials="J" size="md" color="blue" />
      <span aria-hidden className={cx("absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 transition-colors", ease, collapsed ? "border-background-secondary-default" : "border-background-tertiary-default", dot)} />
    </span>
    <Collapsible collapsed={collapsed}><span className="flex w-[178px] flex-col items-start ps-2">
      <span className="text-body-medium text-text-primary">DKI Jakarta</span>
      <span aria-hidden className="text-body-2-regular text-text-secondary">{connection.text}</span>
    </span></Collapsible>
    <span ref={announcement} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
  </div>
}

function Sidebar({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  const { dataMode } = useDataMode()
  const client = useQueryClient()
  const cases = useAssistanceCounts()
  const [refreshing, setRefreshing] = useState(false)
  const items: SidebarItem[] = navigation.map((item) => item.path === "/operations/assistance" && dataMode === "REFERENCE" && cases.data?.open ? { ...item, badge: cases.data.open } : item)
  const secondaryItems: SidebarItem[] = [
    { label: "Refresh data", icon: RiRefreshLine, busy: refreshing, onSelect: () => { setRefreshing(true); void client.invalidateQueries({ queryKey: ["command"] }).finally(() => { setRefreshing(false) }) } },
    { label: "About this data", path: "/about", icon: RiInformationLine },
  ]
  return <DashboardSidebar
    items={items}
    secondaryItems={secondaryItems}
    brand={(collapsed) => <Brand collapsed={collapsed} onNavigate={onClose} />}
    control={(collapsed) => <DataEnvironment collapsed={collapsed} />}
    card={(collapsed) => <WorkspaceCard collapsed={collapsed} />}
    mobile={mobile}
    onClose={onClose}
  />
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [keyboardMotion, setKeyboardMotion] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useLayoutEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true })
    const pageScroll = document.getElementById("app-page-scroll")
    if (pageScroll) pageScroll.scrollTop = 0
  }, [location.pathname])

  useEffect(() => {
    function closeMobileNavigation() {
      if (window.innerWidth >= 1024) setMobileOpen(false)
    }

    window.addEventListener("resize", closeMobileNavigation)
    return () => { window.removeEventListener("resize", closeMobileNavigation) }
  }, [])

  return (
    <div className="relative h-dvh overflow-hidden bg-background-full max-lg:overflow-x-clip" onKeyDownCapture={(event) => { if (event.key === "Escape") queueMicrotask(() => { setKeyboardMotion(true) }); else setKeyboardMotion(true) }} onPointerDownCapture={() => { setKeyboardMotion(false) }}>
      <div
        style={{ transform: mobileOpen ? "translateX(272px)" : "none", borderRadius: mobileOpen ? 32 : 0 }}
        className={`relative z-20 flex h-dvh min-h-0 overflow-hidden bg-background-page transition-[transform,border-radius] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none lg:z-auto lg:!transform-none lg:!rounded-none ${mobileOpen ? "duration-250" : "duration-200"} ${keyboardMotion ? "transition-none!" : ""}`}
      >
        <a className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-2 text-body-semibold text-primary-foreground shadow-lg focus:translate-y-0" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus({ preventScroll: true }) }}>Skip to content</a>
        <div className="z-10 hidden h-full shrink-0 py-3 ps-3 lg:block">
          <Sidebar />
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" id="app-page-scroll">
          <div className="flex items-center gap-3 px-4 pt-4 sm:px-6 lg:hidden">
            <Button aria-label="Open navigation" aria-expanded={mobileOpen} iconOnly leadingIcon={RiMenuLine} onClick={() => { setMobileOpen((open) => !open) }} className="size-11 transition-none!" variant="secondary" />
            <MobileNavigation open={mobileOpen} onOpenChange={setMobileOpen} instant={keyboardMotion}>
              <Sidebar mobile onClose={() => { setMobileOpen(false) }} />
            </MobileNavigation>
            <span className="text-headline-semibold text-text-primary">EvacuAid</span>
          </div>
          <main className="mx-auto flex w-full min-w-0 max-w-[1364px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7" id="main-content" tabIndex={-1}>
            <div className="min-w-0">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
