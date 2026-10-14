import type { ReactNode, Ref } from "react";
import { Switch as AriaSwitch } from "react-aria-components";
import type { SwitchProps as AriaSwitchProps } from "react-aria-components";

import { cx, sortCx } from "@/utils/cx";

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchShape = "pill" | "rectangle";

const switchSizes = sortCx({
    sm: {
        track: "h-4 w-7",
        trackRadius: { pill: "rounded-full", rectangle: "rounded-[3px]" },
        onShadow: "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.5px_var(--color-accent-500)]",
        thumb: "size-3",
        thumbRadius: { pill: "rounded-full", rectangle: "rounded-[1px]" },
        offset: "left-0.5 top-0.5",
        travel: "translate-x-3",
    },
    md: {
        track: "h-6 w-[42px]",
        trackRadius: { pill: "rounded-full", rectangle: "rounded-[4.5px]" },
        onShadow: "shadow-[inset_0_1.5px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.75px_var(--color-accent-500)]",
        thumb: "size-[18px]",
        thumbRadius: { pill: "rounded-full", rectangle: "rounded-[1.5px]" },
        offset: "left-[3px] top-[3px]",
        travel: "translate-x-[18px]",
    },
    lg: {
        track: "h-8 w-14",
        trackRadius: { pill: "rounded-full", rectangle: "rounded-md" },
        onShadow: "shadow-checkbox-selected",
        thumb: "size-6",
        thumbRadius: { pill: "rounded-full", rectangle: "rounded-xs" },
        offset: "left-1 top-1",
        travel: "translate-x-6",
    },
});

interface SwitchVisualState {
    isSelected: boolean;
    isDisabled: boolean;
    isFocusVisible: boolean;
}

function SwitchTrack({ state, size = "md", shape = "pill" }: {
    state: SwitchVisualState;
    size?: SwitchSize;
    shape?: SwitchShape;
}) {
    const styles = switchSizes[size];

    return (
        <span
            aria-hidden
            className={cx(
                "relative shrink-0 transition-colors duration-200 ease",
                styles.track,
                styles.trackRadius[shape],
                state.isSelected
                    ? cx("bg-linear-to-b from-accent-500 to-accent-600", styles.onShadow)
                    : "bg-background-tertiary-default",
                state.isDisabled && "opacity-50",
                state.isFocusVisible && "ring-2 ring-border-focus-ring ring-offset-2",
            )}
        >
            <span
                className={cx(
                    "absolute flex items-center justify-center bg-linear-to-b from-control-indicator-background from-[43.837%] to-control-indicator-background-subtle shadow-[0_3px_3px_0_rgb(0_0_0/0.03),0_0.75px_0_0_rgb(0_0_0/0.05)] transition-transform duration-200 ease",
                    styles.thumb,
                    styles.thumbRadius[shape],
                    styles.offset,
                    state.isSelected && styles.travel,
                )}
            >
            </span>
        </span>
    );
}

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
    children?: ReactNode;
    size?: SwitchSize;
    shape?: SwitchShape;
    ref?: Ref<HTMLLabelElement>;
}

export function Switch({ className, children, size = "md", shape = "pill", ref, ...props }: SwitchProps) {
    return (
        <AriaSwitch
            ref={ref}
            {...props}
            className={(state) => cx(
                "group relative inline-flex items-center gap-2 select-none",
                state.isDisabled ? "cursor-not-allowed" : "cursor-pointer",
                typeof className === "function" ? className(state) : className,
            )}
        >
            {(state) => <>
                <SwitchTrack state={state} size={size} shape={shape} />
                {children != null && children !== false && <span className="text-body-medium text-text-primary">{children}</span>}
            </>}
        </AriaSwitch>
    );
}
