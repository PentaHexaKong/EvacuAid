import type { ReactNode } from "react";
import type { RemixiconComponentType } from "@remixicon/react";

import { cn } from "@/lib/utils";

export type PageHeaderAccent =
    | "brand"
    | "cyan"
    | "teal"
    | "emerald"
    | "amber"
    | "orange"
    | "purple";

const ACCENT_CLASSES: Record<PageHeaderAccent, string> = {
    brand: "bg-brand-default/10 text-brand-default",
    cyan: "bg-status-cyan-background text-status-cyan-text",
    teal: "bg-status-cyan-background text-status-cyan-text",
    emerald: "bg-calendar-event-emerald-background text-calendar-event-emerald-title",
    amber: "bg-status-yellow-background text-status-yellow-text",
    orange: "bg-status-yellow-background text-status-yellow-text",
    purple: "bg-status-purple-background text-status-purple-text",
};

export function PageHeader({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <header
            data-slot="page-header"
            className={cn(
                "flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between",
                className,
            )}
        >
            {children}
        </header>
    );
}

export function PageHeaderWithIcon({ icon, title, description }: {
    icon: RemixiconComponentType;
    title: string;
    description: string;
}) {
    return (
        <PageHeader>
            <PageHeaderMeta>
                <PageHeaderIcon icon={icon} />
                <PageHeaderSummary>
                    <PageHeaderTitle>{title}</PageHeaderTitle>
                    <PageHeaderDescription>{description}</PageHeaderDescription>
                </PageHeaderSummary>
            </PageHeaderMeta>
        </PageHeader>
    );
}

export function PageHeaderMeta({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            data-slot="page-header-meta"
            className={cn("flex min-w-0 flex-1 items-start gap-4", className)}
        >
            {children}
        </div>
    );
}

export function PageHeaderIcon({
    icon: Icon,
    accent = "brand",
    className,
}: {
    icon: RemixiconComponentType;
    accent?: PageHeaderAccent;
    className?: string;
}) {
    return (
        <span
            aria-hidden
            data-slot="page-header-icon"
            className={cn(
                "inline-flex size-11 shrink-0 items-center justify-center rounded-md",
                ACCENT_CLASSES[accent],
                className,
            )}
        >
            <Icon className="size-6" />
        </span>
    );
}

export function PageHeaderSummary({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            data-slot="page-header-summary"
            className={cn("flex min-w-0 flex-col gap-1.5", className)}
        >
            {children}
        </div>
    );
}

export function PageHeaderTitle({
    children,
    className,
    as: Comp = "h1",
}: {
    children: ReactNode;
    className?: string;
    as?: "h1" | "h2";
}) {
    return (
        <Comp
            data-slot="page-header-title"
            className={cn(
                "text-display-4-medium wrap-anywhere text-foreground-default",
                className,
            )}
        >
            {children}
        </Comp>
    );
}

export function PageHeaderDescription({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <p
            data-slot="page-header-description"
            className={cn(
                "max-w-2xl text-body-regular text-pretty text-foreground-light",
                className,
            )}
        >
            {children}
        </p>
    );
}

export function PageHeaderAside({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            data-slot="page-header-aside"
            className={cn(
                "flex shrink-0 flex-wrap items-center gap-2",
                className,
            )}
        >
            {children}
        </div>
    );
}
