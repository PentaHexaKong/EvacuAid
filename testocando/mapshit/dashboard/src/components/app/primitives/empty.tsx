import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border-dashed border-border-stronger p-6 text-center text-balance dark:border-border-button-white",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-1", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-8 shrink-0 items-center justify-center rounded-md bg-background-muted text-foreground-default [&_svg:not([class*='size-'])]:size-4",
      },
      tone: {
        neutral: "",
        brand: "bg-brand-default/10 text-brand-default",
        cyan: "bg-status-cyan-background text-status-cyan-text",
        emerald: "bg-calendar-event-emerald-background text-calendar-event-emerald-title",
        amber: "bg-status-yellow-background text-status-yellow-text",
      },
    },
    compoundVariants: [
      {
        variant: "icon",
        tone: "brand",
        class: "bg-brand-default/10 text-brand-default",
      },
      {
        variant: "icon",
        tone: "cyan",
        class: "bg-status-cyan-background text-status-cyan-text",
      },
      {
        variant: "icon",
        tone: "emerald",
        class: "bg-calendar-event-emerald-background text-calendar-event-emerald-title",
      },
      {
        variant: "icon",
        tone: "amber",
        class: "bg-status-yellow-background text-status-yellow-text",
      },
    ],
    defaultVariants: {
      variant: "default",
      tone: "neutral",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  tone = "neutral",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      data-tone={tone}
      className={cn(emptyMediaVariants({ variant, tone, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-heading text-body-medium text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-caption-1-regular text-pretty text-foreground-light [&>a]:text-brand-link [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2 text-caption-1-regular text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
