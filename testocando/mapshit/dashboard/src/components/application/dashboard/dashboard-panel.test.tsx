import { cleanup, render, screen } from "@testing-library/react"
import { RiGroupLine } from "@remixicon/react"
import { afterEach, expect, test } from "vitest"

import { DashboardStatCard } from "@/components/application/dashboard/dashboard-panel"

afterEach(cleanup)

test("renders a statistic in its own glass shell", () => {
  render(<DashboardStatCard stat={{ caption: "Compared with last month", delta: "+8%", deltaTone: "positive", icon: RiGroupLine, label: "Employees", tone: "purple", value: 42 }} />)

  const article = screen.getByRole("article", { name: "Employees" })
  const panel = article.querySelector('[data-slot="dashboard-panel"]')
  const content = article.querySelector('[data-slot="dashboard-panel-content"]')
  expect(panel).toHaveClass("rounded-2xl", "border-border-button-white", "bg-background-secondary-default", "shadow-sidebar")
  expect(content).toHaveClass("rounded-xl", "border-border-button-default", "bg-background-inner-default")
  expect(screen.getByText("42")).toHaveClass("tabular-nums")
  expect(screen.getByText("+8%")).toHaveClass("bg-status-lime-background", "text-status-lime-text")
})
