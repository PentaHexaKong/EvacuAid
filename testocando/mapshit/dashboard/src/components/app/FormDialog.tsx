import { Children, isValidElement, useId, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";

import { CloseButton } from "@/components/base/buttons/close-button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/base/dialog/dialog";
import { useDialog } from "@/components/base/dialog/dialog-context";
import { cn } from "@/lib/utils";

export const FORM_DIALOG_CONTENT_CLASS =
    "flex max-h-[min(720px,calc(100dvh-2rem))] flex-col overflow-hidden rounded-2xl border-border-button-white bg-background-secondary-default p-1 pt-3 pb-3 shadow-sidebar";

export const FORM_DIALOG_HEADER_CLASS =
    "sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b-0 bg-transparent px-3 pt-0 pb-3";

export const FORM_DIALOG_BODY_CLASS =
    "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border-button-default bg-background-default p-4 dark:border-border-button-white";

export const FORM_DIALOG_FOOTER_CLASS =
    "relative z-10 shrink-0 border-t-0 bg-transparent px-3 pt-3 pb-0";

export { Dialog as FormDialog, DialogTitle as FormDialogTitle };

export function FormDialogContent({
    className,
    size = "md",
    ...props
}: ComponentProps<typeof DialogContent>) {
    return (
        <DialogContent
            size={size}
            className={cn(FORM_DIALOG_CONTENT_CLASS, className)}
            {...props}
        />
    );
}

export function FormDialogHeader({
    className,
    children,
    closeDisabled = false,
    ...props
}: ComponentProps<typeof DialogHeader> & { closeDisabled?: boolean }) {
    const { change } = useDialog();
    return (
        <DialogHeader
            className={cn(FORM_DIALOG_HEADER_CLASS, className)}
            {...props}
        >
            {children}
            <CloseButton
                aria-label="Close"
                disabled={closeDisabled}
                size="sm"
                onClick={() => { change(false) }}
            />
        </DialogHeader>
    );
}

function FormDialogBodyMotion({ children, activeStep, animateResize }: { children: ReactNode; activeStep?: number; animateResize: boolean }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const previousWidth = useRef<number | null>(null);

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const content = viewport?.querySelector<HTMLElement>(activeStep === undefined ? ":scope > div" : ':scope > [data-active="true"]');
        if (!viewport || !content) return;
        if (activeStep !== undefined) {
            if (viewport.parentElement) viewport.parentElement.scrollTop = 0;
            const target = content.querySelector<HTMLElement>('[data-step-focus]') ?? content.querySelector<HTMLElement>('input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]');
            (target ?? content).focus({ preventScroll: true });
        }
        if (!animateResize) {
            viewport.style.height = "";
            previousWidth.current = null;
            return;
        }
        const resize = (instant = false) => {
            const width = content.offsetWidth;
            const skipMotion = instant || previousWidth.current === null || previousWidth.current !== width;
            const transition = viewport.style.transition;
            if (skipMotion) viewport.style.transition = "none";
            viewport.style.height = `${String(content.offsetHeight)}px`;
            if (skipMotion) {
                void viewport.offsetHeight;
                viewport.style.transition = transition;
            }
            previousWidth.current = width;
        };
        resize();
        const observer = new ResizeObserver(() => { resize(); });
        observer.observe(content);
        const resizeViewport = () => { resize(true); };
        window.addEventListener("resize", resizeViewport);
        return () => { observer.disconnect(); window.removeEventListener("resize", resizeViewport); };
    }, [activeStep, animateResize]);

    return <div ref={viewportRef} data-slot="form-dialog-motion" data-page={activeStep} className={cn("shrink-0 gap-[inherit]", animateResize && "t-resize", activeStep !== undefined && "t-page-slide form-dialog-steps")}>
        {activeStep === undefined ? <div className="flex flex-col gap-[inherit]">{children}</div> : Children.toArray(children).map((child, index) => <section key={isValidElement(child) ? child.key : typeof child === "string" || typeof child === "number" ? child : null} className="t-page flex flex-col gap-4 outline-none" data-page-id={index + 1} data-active={activeStep === index + 1} aria-hidden={activeStep !== index + 1} inert={activeStep !== index + 1} tabIndex={-1} style={{ "--t-page-from-x": index + 1 < activeStep ? "calc(var(--page-slide-distance) * -1)" : "var(--page-slide-distance)" } as CSSProperties}>{child}</section>)}
    </div>;
}

export function FormDialogBody({
    className,
    children,
    animateResize = true,
    activeStep,
    ...props
}: ComponentProps<"div"> & { animateResize?: boolean; activeStep?: number }) {
    return (
        <div className={cn(FORM_DIALOG_BODY_CLASS, className)} {...props}>{animateResize || activeStep !== undefined ? <FormDialogBodyMotion animateResize={animateResize} activeStep={activeStep}>{children}</FormDialogBodyMotion> : children}</div>
    );
}

/**
 * Titled group of fields inside FormDialogBody. Every section after the first gets a divider that
 * bleeds to the body edges (-mx-4 cancels the body's p-4), and the title is quieter than field labels.
 */
export function FormDialogSection({ title, first = false, className, children }: { title: string; first?: boolean; className?: string; children: ReactNode }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className={cn("grid gap-4 sm:grid-cols-2", !first && "-mx-4 border-t border-border-table px-4 pt-6", className)}>
            <h3 id={id} className="text-body-medium text-text-tertiary sm:col-span-2">{title}</h3>
            {children}
        </section>
    );
}

export function FormDialogFooter({
    className,
    ...props
}: ComponentProps<typeof DialogFooter>) {
    return (
        <DialogFooter
            className={cn(FORM_DIALOG_FOOTER_CLASS, className)}
            {...props}
        />
    );
}
