import { cx } from "@/utils/cx"

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("flex min-w-0 items-center gap-2 whitespace-nowrap text-title-3-semibold tracking-tight", className)}>
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-accent-600">E</span>{" "}
    <span className="hidden min-[480px]:inline">EvacuAid</span>{" "}
    <span aria-hidden className="hidden h-5 md:block border-l border-white/30" />
    <span className="hidden text-body-medium md:inline">Command center</span>
  </span>
}
