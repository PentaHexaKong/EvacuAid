import type { ReactNode, Ref } from "react";
import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
} from "react-aria-components";
import type {
  RadioGroupProps as AriaRadioGroupProps,
  RadioProps as AriaRadioProps,
} from "react-aria-components";
import { cx } from "@/utils/cx";

export type RadioSize = "sm" | "md";

const dotStyles = {
  sm: {
    dot: "size-3.5",
    inner: "size-[5px]",
    selected:
      "bg-linear-to-b from-accent-500 to-accent-600 shadow-[inset_0px_0px_0px_0.875px_var(--color-accent-500),inset_0px_1.75px_0px_0px_rgba(255,255,255,0.25)]",
    border: "border-[0.875px]",
    gap: "gap-2",
    label: "text-body-2-medium",
  },
  md: {
    dot: "size-4",
    inner: "size-1.5",
    selected:
      "bg-linear-to-b from-accent-500 to-accent-600 shadow-[inset_0px_0px_0px_1px_var(--color-accent-500),inset_0px_2px_0px_0px_rgba(255,255,255,0.25)]",
    border: "border",
    gap: "gap-2",
    label: "text-body-medium",
  },
};

interface RadioDotProps {
  selected?: boolean;
  size?: RadioSize;

  focusVisible?: boolean;
  className?: string;
}

function RadioDot({ selected = false, size = "sm", focusVisible = false, className }: RadioDotProps) {
  const s = dotStyles[size];
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex shrink-0 items-center justify-center rounded-full",
        s.dot,
        focusVisible && "ring-2 ring-border-focus-ring ring-offset-2",
        className,
      )}
    >

      <span
        className={cx(
          "absolute inset-0 rounded-full border-border-checkbox-default bg-background-primary-default shadow-xs",
          "transition-opacity duration-200 ease motion-reduce:transition-none",
          s.border,
          selected && "opacity-0",
        )}
      />

      <span
        className={cx(
          "absolute inset-0 rounded-full",
          "transition-opacity duration-200 ease motion-reduce:transition-none",
          s.selected,
          !selected && "opacity-0",
        )}
      />

      <span
        className={cx(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-control-indicator-background",
          "transition-[scale,opacity] duration-200 ease motion-reduce:transition-none",
          s.inner,
          selected ? "scale-100 opacity-100" : "scale-90 opacity-0",
        )}
      />
    </span>
  );
}

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children"> {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function RadioGroup({ className, children, ref, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "flex flex-col gap-2",
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {children}
    </AriaRadioGroup>
  );
}

export interface RadioProps extends Omit<AriaRadioProps, "children"> {
  children?: ReactNode;
  size?: RadioSize;
  ref?: Ref<HTMLLabelElement>;
}

export function Radio({ className, children, size = "md", ref, ...props }: RadioProps) {
  const s = dotStyles[size];

  return (
    <AriaRadio
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "group inline-flex items-center select-none",
          s.gap,
          state.isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {(state) => (
        <>
          <RadioDot selected={state.isSelected} size={size} focusVisible={state.isFocusVisible} />
          {children !== undefined && children !== null && (
            <span className={cx(s.label, "text-text-primary")}>{children}</span>
          )}
        </>
      )}
    </AriaRadio>
  );
}
