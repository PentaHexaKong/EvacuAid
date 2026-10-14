import { RiCloseLine, RiSearchLine, RiSideBarFill, type RemixiconComponentType } from "@remixicon/react"
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/base/tooltip/tooltip"
import { cx } from "@/utils/cx"

/**
 * BoardUI floating sidebar (boardui.com/components/sidebar). Expanded: 260px,
 * p-3, radius/3xl, white hairline border, sidebar elevation. Collapsed: a 60px
 * rail, 1px border + 11px padding leaving a 36px column for the w-9 items.
 * The panel width animates while labels, badges and the kbd hint collapse via
 * max-width + opacity + blur, so icons stay pinned instead of re-centering.
 */

export type SidebarItem = {
  label: string
  icon: RemixiconComponentType
  /** Route rows navigate; action rows run `onSelect` instead. */
  path?: string
  onSelect?: () => void
  badge?: ReactNode
  busy?: boolean
}

const collapsedKey = "evacuaid.command.sidebar-mode"
const ease = "duration-300 ease-in-out motion-reduce:transition-none"

export function Collapsible({ collapsed, children, className }: { collapsed: boolean; children: ReactNode; className?: string }) {
  return <span className={cx(
    "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter]", ease,
    collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-full opacity-100 blur-0",
    className,
  )}>{children}</span>
}

export function SidebarTooltip({ children, label, show }: { children: ReactElement; label: string; show: boolean }) {
  return <Tooltip isDisabled={!show}><TooltipTrigger isDisabled={!show}>{children}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
}

function NavRow({ item, collapsed, onNavigate }: { item: SidebarItem; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  const { pathname } = useLocation()
  const selected = item.path !== undefined && (pathname === item.path || pathname.startsWith(item.path + "/"))
  const className = cx(
    "flex h-10 cursor-pointer items-center justify-between overflow-hidden rounded-2lg p-2 outline-none transition-[width,background-color]", ease,
    "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
    collapsed ? "w-9" : "w-full",
    selected ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected" : "hover:bg-background-secondary-hover",
  )
  const content = <>
    <span className="flex min-w-0 items-center gap-2">
      <Icon className={cx("size-5 shrink-0", selected ? "text-white" : "text-foreground-icon-secondary", item.busy && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <Collapsible collapsed={collapsed}><span className={cx("text-body-medium whitespace-nowrap", selected ? "text-white" : "text-text-secondary")}>{item.label}</span></Collapsible>
    </span>
    {item.badge !== undefined && <Collapsible collapsed={collapsed}><span className={cx("inline-flex items-center justify-center rounded-sm px-1 py-px text-caption-1-semibold tracking-normal whitespace-nowrap", selected ? "bg-accent-400 text-white" : "bg-badge-neutral-background text-text-secondary")}>{item.badge}</span></Collapsible>}
  </>
  return <SidebarTooltip label={item.label} show={collapsed}>{item.path === undefined
    ? <button type="button" aria-label={item.label} aria-busy={item.busy || undefined} onClick={item.onSelect} className={className}>{content}</button>
    : <Link to={item.path} aria-label={item.label} aria-current={selected ? "page" : undefined} onClick={onNavigate} className={className}>{content}</Link>}
  </SidebarTooltip>
}

function useCollapsed(mobile: boolean) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(collapsedKey) === "Collapsed" } catch { return false }
  })
  function toggle() {
    setCollapsed(!collapsed)
    try { localStorage.setItem(collapsedKey, collapsed ? "Expanded" : "Collapsed") } catch { /* storage unavailable: keep the in-memory state */ }
  }
  return { collapsed: !mobile && collapsed, expand: () => { if (collapsed) toggle() }, toggle }
}

export function DashboardSidebar({ items, secondaryItems = [], brand, control, card, mobile = false, onClose, className }: {
  items: readonly SidebarItem[]
  secondaryItems?: readonly SidebarItem[]
  /** Top-left identity block; receives the collapsed state. */
  brand: (collapsed: boolean) => ReactNode
  /** Footer control above the secondary rows (the theme toggle slot in BoardUI). */
  control?: (collapsed: boolean) => ReactNode
  /** Footer card (the team card slot in BoardUI). */
  card?: (collapsed: boolean) => ReactNode
  /** Rendered inside the mobile drawer: always expanded, close button instead of collapse. */
  mobile?: boolean
  onClose?: () => void
  className?: string
}) {
  const { collapsed, expand, toggle } = useCollapsed(mobile)
  const go = useNavigate()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const matches = (item: SidebarItem) => item.label.toLocaleLowerCase().includes(normalized)
  const shown = items.filter(matches)
  const shownSecondary = secondaryItems.filter(matches)

  function startSearch() { expand(); setSearching(true) }
  function stopSearch(restoreFocus: boolean) {
    setQuery("")
    setSearching(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  function navigate() { if (searching) stopSearch(false); onClose?.() }

  useEffect(() => {
    if (!searching) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const outside = (event: MouseEvent) => { if (!(event.target instanceof Node && fieldRef.current?.contains(event.target))) stopSearch(false) }
    document.addEventListener("click", outside)
    return () => { cancelAnimationFrame(frame); document.removeEventListener("click", outside) }
  }, [searching])

  useEffect(() => {
    if (mobile) return
    const shortcut = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() === "l" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); startSearch() }
    }
    window.addEventListener("keydown", shortcut)
    return () => { window.removeEventListener("keydown", shortcut) }
  })

  return <TooltipProvider delayDuration={300}><aside
    aria-label="Workspace sidebar"
    data-collapsed={collapsed}
    className={cx(
      "flex h-full shrink-0 flex-col justify-between overflow-hidden rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar transition-[width]", ease,
      collapsed ? "w-[60px] px-[11px] py-3" : mobile ? "w-full p-3" : "w-[260px] p-3",
      className,
    )}
  >
    {/* The scroller clips on both axes, so pad its clip edge out by 8px and borrow it back: focus rings and the selected shadow stay visible. */}
    <div className="-m-2 flex min-h-0 w-[calc(100%+16px)] flex-col gap-3 overflow-y-auto p-2 [scrollbar-width:none]">
      <div className={cx("flex w-full transition-[gap]", ease, collapsed ? "flex-col-reverse items-start justify-center gap-2.5" : "flex-row items-center justify-between gap-2")}>
        <div className="-m-2 min-w-0 overflow-hidden p-2">{brand(collapsed)}</div>
        {mobile
          ? <button type="button" aria-label="Close sidebar" onClick={onClose} className="-m-3 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-foreground-icon-secondary outline-none hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiCloseLine className="size-5" aria-hidden /></button>
          : <SidebarTooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} show={collapsed}><button
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              onClick={() => { if (!collapsed) stopSearch(false); toggle() }}
              className={cx("flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-foreground-icon-secondary outline-none transition-colors duration-150 hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring", !collapsed && "-me-2")}
            ><RiSideBarFill className={cx("size-5 transition-transform", ease, !collapsed && "-scale-x-100")} aria-hidden /></button></SidebarTooltip>}
      </div>

      <div className="flex w-full flex-col gap-3">
        {searching && !collapsed
          ? <div ref={fieldRef} className="flex h-10 w-full items-center gap-2 rounded-full bg-background-tertiary-default pe-2.5 ps-2 ring-2 ring-inset ring-border-button-active">
              <RiSearchLine className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                aria-label="Filter navigation"
                value={query}
                onChange={(event) => { setQuery(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stopSearch(true) }
                  if (event.key === "Enter") { const first = [...shown, ...shownSecondary][0]; if (first) { navigate(); first.onSelect?.(); if (first.path) void go(first.path) } }
                }}
                placeholder="Search navigation…"
                className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden"
              />
              <button type="button" aria-label="Clear navigation search" onClick={() => { stopSearch(true) }} className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background-tertiary-hover text-foreground-icon-secondary outline-none hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiCloseLine className="size-3.5" aria-hidden /></button>
            </div>
          : <SidebarTooltip label="Quick search" show={collapsed}><button
              ref={triggerRef}
              type="button"
              aria-label="Quick search"
              aria-keyshortcuts={mobile ? undefined : "Meta+L Control+L"}
              onClick={startSearch}
              className={cx("flex h-10 cursor-pointer items-center gap-2 rounded-full bg-background-tertiary-default p-2 outline-none transition-[width,background-color] hover:bg-background-tertiary-hover/55 focus-visible:ring-2 focus-visible:ring-border-focus-ring", ease, collapsed ? "w-9" : "w-full")}
            >
              <span className={cx("flex min-w-0 items-center gap-2", !collapsed && "flex-1")}>
                <RiSearchLine className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <Collapsible collapsed={collapsed}><span className="text-body-medium whitespace-nowrap text-text-secondary">Quick search</span></Collapsible>
              </span>
              {!mobile && <Collapsible collapsed={collapsed}><kbd className="inline-flex items-center justify-center rounded-full bg-kbd-background px-1 py-0.5 font-sans text-caption-1-semibold tracking-normal whitespace-nowrap text-kbd-foreground">⌘L</kbd></Collapsible>}
            </button></SidebarTooltip>}

        {/* The 2px inset is for the expanded rail only: collapsed, the column is exactly one 36px item wide. */}
        <nav aria-label="Primary" className={cx("flex w-full flex-col gap-1", !collapsed && "px-0.5")}>
          {shown.map((item) => <NavRow key={item.label} item={item} collapsed={collapsed} onNavigate={navigate} />)}
          {!shown.length && !shownSecondary.length && <p role="status" className="px-2 py-3 text-body-regular text-text-tertiary">No matching pages</p>}
        </nav>
      </div>
    </div>

    <div className="flex w-full shrink-0 flex-col gap-3 pt-3">
      {control?.(collapsed)}
      {shownSecondary.length > 0 && <nav aria-label="Secondary" className="flex w-full flex-col gap-1">{shownSecondary.map((item) => <NavRow key={item.label} item={item} collapsed={collapsed} onNavigate={navigate} />)}</nav>}
      {card?.(collapsed)}
    </div>
  </aside></TooltipProvider>
}
