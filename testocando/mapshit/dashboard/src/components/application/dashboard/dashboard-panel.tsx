import type { ReactNode } from "react"
import type { RemixiconComponentType } from "@remixicon/react"
import { RiArrowDownLine, RiArrowUpLine, RiSubtractLine } from "@remixicon/react"

import { Chip } from "@/components/base/badges/chip"
import { cn } from "@/lib/utils"

export function DashboardPanel({
  children,
  className,
  contentClassName,
  header,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
  header: ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border border-border-button-white bg-background-secondary-default p-1 pt-3 shadow-sidebar", className)} data-slot="dashboard-panel">
      <div className="flex min-h-9 items-center px-3 pb-3">{header}</div>
      <div className={cn("min-w-0 flex-1 overflow-hidden rounded-xl border border-border-button-default bg-background-inner-default dark:border-border-button-white", contentClassName)} data-slot="dashboard-panel-content">
        {children}
      </div>
    </div>
  )
}

/** Panel heading: icon + title, with an optional aside (caption, legend). */
export function DashboardPanelTitle({ aside, icon: Icon, id, title }: { aside?: ReactNode; icon: RemixiconComponentType; id: string; title: string }) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2"><Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" /><h2 className="truncate text-body-medium text-text-primary" id={id}>{title}</h2></div>
      {aside && <div className="flex min-w-0 flex-wrap items-center gap-3">{aside}</div>}
    </div>
  )
}

type StatTone = "blue" | "purple" | "emerald" | "orange"
type DeltaTone = "positive" | "negative" | "neutral"

const tileClasses: Record<StatTone, string> = {
  blue: "bg-linear-to-b from-status-blue-background to-notification-information-background text-status-blue-text",
  purple: "bg-linear-to-b from-status-purple-background to-calendar-event-purple-background text-status-purple-text",
  emerald: "bg-linear-to-b from-calendar-event-emerald-background to-notification-success-background text-calendar-event-emerald-title",
  orange: "bg-linear-to-b from-status-yellow-background to-calendar-event-lime-background text-status-yellow-text",
}

const deltaIcons: Record<DeltaTone, RemixiconComponentType> = {
  positive: RiArrowUpLine,
  negative: RiArrowDownLine,
  neutral: RiSubtractLine,
}

export type DashboardStat = {
  caption: string
  delta?: string
  deltaTone?: DeltaTone
  icon: RemixiconComponentType
  label: string
  tone: StatTone
  value: number
}

export function DashboardStatCard({ stat }: { stat: DashboardStat }) {
  const DeltaIcon = deltaIcons[stat.deltaTone ?? "neutral"]
  const Icon = stat.icon
  const titleId = `dashboard-stat-${stat.label.toLowerCase().replaceAll(" ", "-")}`

  return (
    <article aria-labelledby={titleId}>
      <DashboardPanel
        className="h-full"
        contentClassName="flex min-h-32 flex-col"
        header={(
          <div className="flex w-full items-center gap-2.5">
            <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg inset-shadow-xs", tileClasses[stat.tone])}>
              <Icon className="size-5" />
            </span>
            <h2 className="min-w-0 flex-1 text-body-medium text-text-primary" id={titleId}>{stat.label}</h2>
          </div>
        )}
      >
        <div className="flex flex-1 items-center px-4 py-5">
          <p className="text-display-4-semibold tabular-nums text-text-primary">{stat.value.toLocaleString()}</p>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border-table bg-background-primary-default px-4 py-3">
          <span className="text-caption-1-regular text-text-secondary-strong">{stat.caption}</span>
          {stat.delta !== undefined && <Chip className="shrink-0 gap-1 tabular-nums" color={stat.deltaTone === "positive" ? "lime" : stat.deltaTone === "negative" ? "rose" : "neutral"} variant="caption">
            <DeltaIcon aria-hidden className="size-3.5" />
            {stat.delta}
          </Chip>}
        </footer>
      </DashboardPanel>
    </article>
  )
}
