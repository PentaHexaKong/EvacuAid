import { RiArrowDownSLine, RiCloseLine, RiSideBarLine, type RemixiconComponentType } from "@remixicon/react"
import { useEffect, useId, useState, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { Link, useLocation, useMatch, useNavigate } from "react-router"
import { Button as AriaButton } from "react-aria-components"

import { Radio, RadioGroup } from "@/components/base/radio/radio"
import { Avatar } from "@/components/base/avatar/avatar"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/base/popover/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/base/tooltip/tooltip"
import { cx } from "@/utils/cx"

type NavigationItem = { label: string; path: string; icon: RemixiconComponentType; section?: string; activePaths?: readonly string[] }
type NavigationGroup = { label: string; icon: RemixiconComponentType; items: readonly NavigationItem[] }
const sidebarModes = ["Expanded", "Collapsed", "Expand on hover"] as const
type SidebarMode = typeof sidebarModes[number]
const sidebarModeKey = "evacuaid.command.sidebar-mode"
const companyAvatarColors = ["neutral", "lime", "pink", "blue"] as const

function Collapsible({ collapsed, children, className }: { collapsed: boolean; children: ReactNode; className?: string }) {
  return <span className={cx(
    "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
    collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-40 opacity-100 blur-0",
    className,
  )}>{children}</span>
}

function SidebarTooltip({ children, label, show }: { children: ReactElement; label: string; show: boolean }) {
  return <Tooltip isDisabled={!show}><TooltipTrigger isDisabled={!show}>{children}</TooltipTrigger><TooltipContent side="right" className="origin-(--transform-origin) transition-[opacity,scale,filter] duration-150 data-instant:transition-none data-[entering]:scale-97 data-[entering]:blur-0 data-[exiting]:scale-97 data-[exiting]:blur-0">{label}</TooltipContent></Tooltip>
}

function NavItem({ item, collapsed, nested = false, secondary = false, onNavigate }: { item: NavigationItem; collapsed: boolean; nested?: boolean; secondary?: boolean; onNavigate: () => void }) {
  const Icon = item.icon
  const { pathname } = useLocation()
  const isActive = Boolean(useMatch({ path: item.path, end: false }))
  const groupActive = item.activePaths?.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  return <SidebarTooltip label={item.label} show={collapsed && !nested}><Link
    to={item.path}
    aria-label={item.label}
    aria-current={isActive || groupActive ? "page" : undefined}
    onClick={onNavigate}
    className={cx(
      "group/nav flex items-center overflow-hidden rounded-2lg text-body-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring motion-reduce:transition-none",
      secondary ? "min-h-10 w-full px-2.5 py-2" : "h-10 w-full px-2.5 py-2",
      (isActive || groupActive)
        ? "bg-linear-to-b from-accent-500 to-accent-600 text-text-white shadow-nav-selected"
        : "text-text-secondary-strong hover:bg-background-secondary-hover",
    )}
  >
    <span className="flex min-w-0 items-center gap-2">
      {!nested && <Icon className="size-5 shrink-0 text-foreground-icon-secondary group-aria-[current=page]/nav:text-text-white" aria-hidden />}
      <Collapsible collapsed={collapsed} className={secondary ? "max-w-full" : undefined}><span className={secondary ? "whitespace-normal break-words" : "whitespace-nowrap"}>{item.label}</span></Collapsible>
    </span>
  </Link></SidebarTooltip>
}

function MobileNavigationTree({ icon: Icon, items, label, onNavigate, active, single = false, collapsed = false, onExpand }: { collapsed?: boolean; onExpand?: () => void; active?: boolean; single?: boolean; icon: RemixiconComponentType; items: readonly NavigationItem[]; label: string; onNavigate: () => void }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(single ? Boolean(active) : true)
  const [previousPath, setPreviousPath] = useState(pathname)
  if (pathname !== previousPath) {
    setPreviousPath(pathname)
    if (single && active) setOpen(true)
  }
  const treeId = useId()

  return <div className="w-full"><SidebarTooltip label={label} show={collapsed}><button
    type="button"
    aria-label={label}
    aria-expanded={open && !collapsed}
    aria-controls={treeId}
    onClick={() => { if (collapsed) { onExpand?.(); setOpen(true) } else setOpen(!open) }}
    className="flex h-10 w-full cursor-pointer items-center justify-between overflow-hidden rounded-2lg px-2.5 py-2 text-text-secondary-strong hover:bg-background-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring"
  ><span className="flex min-w-0 items-center gap-2"><Icon className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden /><Collapsible collapsed={collapsed}><span className="whitespace-nowrap text-body-medium">{label}</span></Collapsible></span><RiArrowDownSLine className={cx(collapsed && "hidden", "size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden /></button></SidebarTooltip>
    <div id={treeId} aria-hidden={!open || collapsed} inert={!open || collapsed} className={cx("grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", open && !collapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="overflow-hidden">
        <ul aria-label={label} className="mt-1 pr-px pb-px">{items.map((item) => <li key={item.path} className="group/tree relative pb-1 pl-9 last:pb-0"><span aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-[18px] border-l border-border-button-hover dark:border-border-button-default group-last/tree:hidden" /><span aria-hidden className="pointer-events-none absolute top-0 left-[18px] h-5.5 w-3.5 rounded-bl-lg border-b border-l border-border-button-hover dark:border-border-button-default" /><NavItem item={item} collapsed={false} nested onNavigate={onNavigate} /></li>)}</ul>
      </div>
    </div>
  </div>
}

function NavigationGroupButton({ active, collapsed, controls, group, onSelect }: { active: boolean; collapsed: boolean; controls: string; group: NavigationGroup; onSelect: () => void }) {
  const Icon = group.icon
  return <SidebarTooltip label={group.label} show={collapsed}><button
    type="button"
    aria-label={group.label}
    aria-expanded={active}
    aria-controls={controls}
    onClick={onSelect}
    className={cx(
      "flex cursor-pointer items-center gap-2 overflow-hidden rounded-2lg text-body-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring motion-reduce:transition-none",
      "h-10 w-full px-2.5 py-2",
      active ? "bg-linear-to-b from-accent-500 to-accent-600 text-text-white shadow-nav-selected" : "text-text-secondary-strong hover:bg-background-secondary-hover",
    )}
  ><Icon className={cx("size-5 shrink-0", !active && "text-foreground-icon-secondary")} aria-hidden /><Collapsible collapsed={collapsed}><span className="whitespace-nowrap">{group.label}</span></Collapsible></button></SidebarTooltip>
}

function SidebarCompanyMenu({ companies, companyId, collapsed, mobile, onCompanyChange, onClose, companyOpen, setCompanyOpen }: Pick<ComponentProps<typeof DashboardSidebar>, "companies" | "companyId" | "mobile" | "onCompanyChange" | "onClose"> & {
  collapsed: boolean
  companyOpen: boolean
  setCompanyOpen: (open: boolean) => void
}) {
  const company = companies.find((item) => item.id === companyId)
  const companyIndex = Math.max(companies.findIndex((item) => item.id === companyId), 0)

  return <div className="min-w-0 flex-1"><Popover onOpenChange={setCompanyOpen} isOpen={companyOpen}>
    <SidebarTooltip label={company?.name ?? "Company"} show={collapsed}><PopoverTrigger><button
      type="button"
      aria-label={`Open company menu for ${company?.name ?? "Company"}`}
      className={cx(
        "relative flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden border-2 border-transparent text-start outline-none transition-[padding,background-color,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none hover:border-border-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring",
        "h-10 rounded-full",
        collapsed ? "bg-transparent px-0.5" : "bg-background-tertiary-default px-2",
        mobile && "min-h-11",
      )}
    >
      <Avatar aria-hidden className="rounded-full ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" color={companyAvatarColors[companyIndex % companyAvatarColors.length]} initials={company?.name.split(" ").at(-1)?.[0] ?? "C"} size={collapsed ? "md" : "sm"} />
      <Collapsible collapsed={collapsed} className="flex-1"><span className="flex w-full min-w-0 items-center justify-between gap-2"><span className="truncate text-body-medium text-text-primary">{company?.name ?? "Company"}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-4 shrink-0 text-foreground-icon-tertiary"><g transform="translate(4.25 2.56)"><path d="M.75 7.44 3.22 9.91a.75.75 0 0 0 1.06 0l2.47-2.47M.75 3.44 3.22.97a.75.75 0 0 1 1.06 0l2.47 2.47" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></g></svg></span></Collapsible>
    </button></PopoverTrigger></SidebarTooltip>
    <PopoverContent animation="notification" variant="custom" align="start" className="w-[265px] max-w-[calc(100vw-32px)] gap-0 overflow-y-auto rounded-2xl border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown! dark:bg-background-secondary-default" side="bottom" sideOffset={8}>
      <div className="flex w-full flex-col gap-1.5 pt-[5px]">
        <PopoverTitle className="px-2 text-body-medium text-text-secondary">Companies</PopoverTitle>
        <div className="flex w-full flex-col gap-1">{companies.map((item, index) => <button
          type="button"
          aria-current={item.id === companyId ? "page" : undefined}
          className={cx("flex w-full cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-left outline-none", item.id === companyId ? "bg-background-primary-hover" : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover")}
          key={item.id}
          onClick={() => {
            setCompanyOpen(false)
            if (item.id !== companyId) void onCompanyChange(item.id)
            onClose?.()
          }}
        ><Avatar aria-hidden className="rounded-full" color={companyAvatarColors[index % companyAvatarColors.length]} initials={item.name.split(" ").at(-1)?.[0] ?? "C"} size="xs" /><span className="truncate text-body-medium text-text-primary">{item.name}</span></button>)}</div>
      </div>
    </PopoverContent>
  </Popover></div>
}

function MobileSidebarClose({ onClose }: Pick<ComponentProps<typeof DashboardSidebar>, "onClose">) {
  return <button type="button" aria-label="Close sidebar" onClick={onClose} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-foreground-icon-secondary hover:bg-background-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring"><RiCloseLine className="size-5" aria-hidden /></button>
}

function SidebarControlSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="flex w-full flex-col">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open) }} className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-body-medium text-text-primary outline-none transition-colors duration-150 hover:bg-background-primary-hover focus-visible:bg-background-primary-hover">
      <RiSideBarLine className="size-5 text-foreground-icon-secondary" aria-hidden />
      <span className="flex-1 text-start">{label}</span>
      <RiArrowDownSLine aria-hidden className={cx("size-4 text-foreground-icon-secondary transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", !open && "-rotate-90")} />
    </button>
    <div id={id} aria-hidden={!open} inert={!open} className={cx("grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="overflow-hidden">{children}</div>
    </div>
  </div>
}

function useSidebarDisplay() {
  const [keyboardMotion, setKeyboardMotion] = useState(false)
  useEffect(() => {
    const key = () => { setKeyboardMotion(true) }
    const pointer = () => { setKeyboardMotion(false) }
    document.addEventListener("keydown", key, true)
    document.addEventListener("pointerdown", pointer, true)
    return () => {
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("pointerdown", pointer, true)
    }
  }, [])
  const [mode, setMode] = useState<SidebarMode>(() => {
    try {
      const saved = localStorage.getItem(sidebarModeKey)
      return sidebarModes.find((item) => item === saved) ?? "Expanded"
    } catch {
      return "Expanded"
    }
  })
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const collapsed = mode === "Collapsed" || (mode === "Expand on hover" && !hovered && !(keyboardMotion && focused))

  function changeMode(nextMode: SidebarMode) {
    setMode(nextMode)
    try {
      localStorage.setItem(sidebarModeKey, nextMode)
    } catch {
      return
    }
  }

  return { keyboardMotion, setKeyboardMotion, mode, changeMode, setHovered, setFocused, collapsed }
}

export function DashboardSidebar({ navigation, navigationGroups = [], companies, companyId, onCompanyChange, mobile = false, layout = "two", onLayoutChange, onClose, className, workspaceHeader, navigationEnd = [] }: {
  workspaceHeader?: (collapsed: boolean) => ReactNode
  navigationEnd?: readonly NavigationItem[]
  navigation: NavigationItem[]
  navigationGroups?: readonly NavigationGroup[]
  companies: Array<{ id: string; name: string }>
  companyId: string
  onCompanyChange: (companyId: string) => Promise<void>
  mobile?: boolean
  layout?: "single" | "two"
  onLayoutChange?: (layout: "single" | "two") => void
  onClose?: () => void
  className?: string
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const panelId = useId()
  const routeGroupLabel = navigationGroups.find((group) => group.items.some((item) => (item.activePaths ?? [item.path]).some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))))?.label ?? null
  const { keyboardMotion, setKeyboardMotion, mode, changeMode, setHovered, setFocused, collapsed } = useSidebarDisplay()
  const [companyOpen, setCompanyOpen] = useState(false)
  const [controlOpen, setControlOpen] = useState(false)
  const selectedGroup = layout === "single" ? undefined : navigationGroups.find((group) => group.label === routeGroupLabel)
  const onNavigate = () => { onClose?.() }

  const sidebarControl = <Popover isOpen={controlOpen} onOpenChange={setControlOpen}>
        <SidebarTooltip label="Sidebar control" show={!mobile && collapsed}><AriaButton onClick={() => { setControlOpen(!controlOpen) }} type="button" aria-label="Sidebar control" className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-text-secondary-strong hover:bg-background-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus-ring"><RiSideBarLine className="size-5" aria-hidden /></AriaButton></SidebarTooltip>
        <PopoverContent animation="notification" variant="custom" side="top" align="start" sideOffset={8} className="max-h-[calc(100dvh-2rem)]! w-[265px] max-w-[calc(100vw-32px)] gap-1.5 overflow-y-auto rounded-2xl border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown! dark:bg-background-secondary-default">
          <PopoverTitle className="px-2 pt-[5px] text-body-medium text-text-secondary">Sidebar control</PopoverTitle>
          <SidebarControlSection label="Sidebar display"><RadioGroup aria-label="Sidebar display" value={mode} onChange={(value) => { const nextMode = sidebarModes.find((item) => item === value); if (nextMode) changeMode(nextMode) }} className="gap-1">{sidebarModes.map((item) => <Radio key={item} value={item} className="min-h-10 w-full gap-2.5 rounded-2lg px-2 py-1.5 hover:bg-background-primary-hover focus-within:bg-background-primary-hover">{item}</Radio>)}</RadioGroup></SidebarControlSection>
          {onLayoutChange && <SidebarControlSection label="Navigation layout">
            <RadioGroup aria-label="Navigation layout" value={layout} onChange={(value) => { if (value === "single" || value === "two") onLayoutChange(value) }} className="gap-1">
              <Radio value="single" className="min-h-10 w-full gap-2.5 rounded-2lg px-2 py-1.5 hover:bg-background-primary-hover focus-within:bg-background-primary-hover">Single sidebar</Radio>
              <Radio value="two" className="min-h-10 w-full gap-2.5 rounded-2lg px-2 py-1.5 hover:bg-background-primary-hover focus-within:bg-background-primary-hover">Two sidebars</Radio>
            </RadioGroup>
          </SidebarControlSection>}
        </PopoverContent>
      </Popover>

  if (mobile) return <TooltipProvider delayDuration={300}><aside aria-label="Workspace sidebar" data-reduced-motion={keyboardMotion ? "" : undefined} onKeyDownCapture={() => { setKeyboardMotion(true) }} onPointerDownCapture={() => { setKeyboardMotion(false) }} className={cx("flex h-full w-full shrink-0 flex-col justify-between gap-3 overflow-hidden border-r border-border-button-white bg-background-secondary-default p-3 shadow-sidebar [&_nav_a]:min-h-11 [&_nav_button]:min-h-11", className)}>
    <div className="flex h-11 w-full shrink-0 items-center justify-between gap-2" data-slot="sidebar-header">{workspaceHeader ? workspaceHeader(false) : <SidebarCompanyMenu companies={companies} companyId={companyId} collapsed={false} mobile={mobile} onCompanyChange={onCompanyChange} onClose={onClose} companyOpen={companyOpen} setCompanyOpen={setCompanyOpen} />}<MobileSidebarClose onClose={onClose} /></div>
    <div className="-m-2 flex min-h-0 w-[calc(100%+16px)] flex-1 flex-col overflow-y-auto p-2 [scrollbar-width:none]"><nav aria-label="Primary" className="flex w-full flex-col gap-1">{navigation.map((item) => <NavItem key={item.path} item={item} collapsed={false} onNavigate={onNavigate} />)}{navigationGroups.map((group) => <MobileNavigationTree single={layout === "single"} active={routeGroupLabel === group.label} key={group.label} icon={group.icon} items={group.items} label={group.label} onNavigate={onNavigate} />)}{navigationEnd.map((item) => <NavItem key={item.path} item={item} collapsed={false} onNavigate={onNavigate} />)}</nav></div>
  </aside></TooltipProvider>

  return <TooltipProvider delayDuration={300}><aside aria-label="Workspace sidebar" data-reduced-motion={keyboardMotion ? "" : undefined} onKeyDownCapture={() => { setKeyboardMotion(true) }} onPointerDownCapture={() => { setKeyboardMotion(false) }} className={cx("relative flex h-full shrink-0 bg-background-secondary-default shadow-sidebar", className)}>
    <div className={cx("relative h-full shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", mode === "Expanded" ? "w-[240px]" : "w-[60px]")}>
    <div
      data-slot="sidebar-rail"
      data-expanded={!collapsed}
      onPointerOver={(event) => { if (event.pointerType !== "touch") { setKeyboardMotion(false); setHovered(event.target instanceof Node && event.currentTarget.contains(event.target)) } }}
      onPointerOut={(event) => { if (event.pointerType !== "touch") { setKeyboardMotion(false); setHovered(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) } }}
      onFocusCapture={(event) => { setFocused(event.currentTarget.contains(event.target)) }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
      className={cx("absolute inset-y-0 left-0 z-20 flex h-full flex-col justify-between gap-3 border-r border-border-button-white bg-background-secondary-default px-2.5 py-3 transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", collapsed ? "w-[60px]" : "w-[240px]", selectedGroup ? "border-border-button-hover shadow-[inset_-1px_0_0_var(--color-white)] dark:border-black/40 dark:shadow-[inset_-1px_0_0_rgb(255_255_255/0.08)]" : mode === "Expand on hover" && !collapsed && "shadow-sidebar")}
    >
      <div className="flex w-full shrink-0 justify-center" data-slot="sidebar-header">{workspaceHeader ? workspaceHeader(collapsed) : <SidebarCompanyMenu companies={companies} companyId={companyId} collapsed={collapsed} mobile={false} onCompanyChange={onCompanyChange} companyOpen={companyOpen} setCompanyOpen={setCompanyOpen} />}</div>
      <div className="-m-2 flex min-h-0 w-[calc(100%+16px)] flex-1 flex-col overflow-y-auto p-2 [scrollbar-width:none]"><nav aria-label="Primary" className="flex w-full flex-col items-center gap-1">{navigation.map((item) => <NavItem key={item.path} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}{navigationGroups.map((group) => layout === "single" ? <MobileNavigationTree key={group.label} single active={routeGroupLabel === group.label} collapsed={collapsed} onExpand={() => { changeMode("Expanded") }} icon={group.icon} items={group.items} label={group.label} onNavigate={onNavigate} /> : <NavigationGroupButton active={selectedGroup?.label === group.label} collapsed={collapsed} controls={panelId} group={group} key={group.label} onSelect={() => { const first = group.items[0]; if (first) void navigate(first.path) }} />)}{navigationEnd.map((item) => <NavItem key={item.path} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}</nav></div>
      {sidebarControl}
    </div>
    </div>
    {selectedGroup && <section aria-label={`${selectedGroup.label} navigation`} className="flex h-full min-h-0 w-[240px] flex-col border-r border-border-button-white bg-background-secondary-default" id={panelId}>
      <div className="flex shrink-0 items-center border-b border-border-button-hover px-5.5 py-4 shadow-[inset_0_-1px_0_var(--color-white)] dark:border-black/40 dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"><h2 className="text-headline-semibold text-text-secondary-strong">{selectedGroup.label}</h2></div>
      <nav aria-label={selectedGroup.label} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:thin]"><ul className="flex flex-col gap-1">{selectedGroup.items.map((item, index) => <li key={item.path}>{index > 0 && item.section && item.section !== selectedGroup.items[index - 1]?.section && <hr className="-mx-3 mt-3 border-0 border-t border-border-button-hover pt-4 shadow-[inset_0_1px_0_var(--color-white)] dark:border-black/40 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" />}<NavItem item={item} collapsed={false} nested secondary onNavigate={onNavigate} /></li>)}</ul></nav>
    </section>}
  </aside></TooltipProvider>
}
