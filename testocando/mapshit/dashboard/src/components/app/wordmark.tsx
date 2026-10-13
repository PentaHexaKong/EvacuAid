import { cx } from "@/utils/cx"

/** EnterpriseHub text logo: one word, weight contrast between "Enterprise" and "Hub". Inherits color from its container. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("text-title-3-semibold tracking-tight whitespace-nowrap", className)}>Enterprise<span className="font-normal">Hub</span></span>
}
