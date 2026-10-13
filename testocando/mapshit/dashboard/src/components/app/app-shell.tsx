import { RiMenuLine as IconMenu2 } from "@remixicon/react"
import { Wordmark } from "@/components/app/wordmark"
import { useEffect, useLayoutEffect, useState } from "react"
import { Outlet, useLocation } from "react-router"
import { Button } from "@/components/base/buttons/button"
import { MobileNavigation } from "@/components/app/MobileNavigation"
import { DashboardSidebar } from "@/components/application/dashboard/dashboard-sidebar"

export function AppShell() {
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
          className={`relative z-20 grid h-dvh min-h-0 grid-rows-[4rem_minmax(0,1fr)] overflow-hidden bg-background-full transition-[transform,border-radius] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none lg:z-auto lg:grid-cols-[auto_1fr] lg:!transform-none lg:!rounded-none ${mobileOpen ? "duration-250" : "duration-200"} ${keyboardMotion ? "transition-none!" : ""}`}
        >
      <a className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-2 text-body-semibold text-primary-foreground shadow-lg focus:translate-y-0" href="#main-content">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-linear-to-b from-primary/90 to-accent-700/85 text-text-white shadow-sidebar backdrop-blur-xl lg:col-span-2">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:pe-8 lg:ps-[22px]">
          <div className="flex min-w-0 items-center gap-3">
            <Button aria-label="Open navigation" aria-expanded={mobileOpen} iconOnly leadingIcon={IconMenu2} onClick={() => { setMobileOpen((open) => !open) }} className="size-11 transition-none! bg-transparent text-text-white hover:bg-white/10 hover:text-text-white aria-expanded:bg-transparent aria-expanded:hover:bg-white/10 lg:hidden" variant="ghost" />
            <MobileNavigation open={mobileOpen} onOpenChange={setMobileOpen} instant={keyboardMotion}>
                <DashboardSidebar
          layout="single"
                  navigation={[]}
                  navigationGroups={[]}
                  companies={[]}
                  companyId=""
                  onCompanyChange={() => Promise.resolve()}
                  mobile
                  onClose={() => { setMobileOpen(false) }}
                  className="w-full border-0 border-r-0 bg-background-full shadow-none!"
                />
            </MobileNavigation>
            <Wordmark className="truncate" />
          </div>
        </div>
      </header>
      <div className="z-10 hidden h-full min-h-0 dark:z-auto lg:block">
        <DashboardSidebar
          layout="single"
          navigation={[]}
          navigationGroups={[]}
          companies={[]}
          companyId=""
          onCompanyChange={() => Promise.resolve()}
        />
      </div>
      <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-background-page" id="app-page-scroll">
        <main className="mx-auto flex w-full min-w-0 max-w-[1364px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7" id="main-content" tabIndex={-1}>
          <div className="min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
        </div>
    </div>
  )
}
