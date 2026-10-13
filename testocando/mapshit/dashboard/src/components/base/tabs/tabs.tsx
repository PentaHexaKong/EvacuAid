"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode, Ref, RefObject } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  Tabs as AriaTabs,
} from "react-aria-components";
import type {
  TabListProps as AriaTabListProps,
  TabProps as AriaTabProps,
  TabsProps as AriaTabsProps,
} from "react-aria-components";
import { cx } from "@/utils/cx";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface TabsProps extends AriaTabsProps {
  ref?: Ref<HTMLDivElement>;
}

export function Tabs({ className, ref, ...props }: TabsProps) {
  return (
    <AriaTabs
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "flex w-full flex-col gap-4 dark:[--color-accent-600:var(--color-blue-600)]",
          state.orientation === "vertical" && "flex-row",
          typeof className === "function" ? className(state) : className,
        )
      }
    />
  );
}

export interface TabListProps<T extends object> extends AriaTabListProps<T> {
  underlinePositionRef?: RefObject<{ left: number; width: number } | null>;
  ref?: Ref<HTMLDivElement>;
}

type Underline = { left: number; width: number };

export function TabList<T extends object>({ className, ref, underlinePositionRef, ...props }: TabListProps<T>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [underline, setUnderline] = useState<Underline | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => {
      const selected = el.querySelector<HTMLElement>("[role='tab'][data-selected]");
      if (selected) {
        const next = { left: selected.offsetLeft, width: selected.offsetWidth };
        if (underlinePositionRef) underlinePositionRef.current = next;
        setUnderline(next);
      }
    };
    let frame = 0;
    if (underlinePositionRef?.current) {
      setUnderline(underlinePositionRef.current);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(measure); });
    } else {
      measure();
    }
    const mo = new MutationObserver(measure);
    mo.observe(el, { attributes: true, subtree: true, attributeFilter: ["data-selected"] });
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(measure); });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
    };
  }, [underlinePositionRef]);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <AriaTabList
        ref={ref}
        {...props}
        className={(state) =>
          cx(
            "flex w-full items-center gap-1 border-b border-border-button-hover dark:border-separator-border",
            typeof className === "function" ? className(state) : className,
          )
        }
      />
      {underline && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-accent-600 transition-[transform,width] duration-200 ease motion-reduce:transition-none"
          style={{
            transform: `translateX(${String(underline.left)}px)`,
            width: underline.width,
          }}
        />
      )}
    </div>
  );
}

export interface TabProps extends Omit<AriaTabProps, "children"> {
  children?: ReactNode;
  icon?: IconComponent;
  count?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function Tab({ className, children, icon: Icon, count, ref, ...props }: TabProps) {
  return (
    <AriaTab
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "relative inline-flex cursor-pointer items-center gap-2.5 px-2.5 py-2 whitespace-nowrap",
          "outline-none transition-colors duration-150 ease motion-reduce:transition-none",
          "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          state.isDisabled && "cursor-not-allowed opacity-50",
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {({ isSelected }) => (
        <>
          <span
            className={cx(
              "inline-flex items-center gap-1.5",
              isSelected
                ? "text-body-medium text-accent-600"
                : "text-body-regular text-text-primary",
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {children}
          </span>
          {count != null && (
            <span
              className={cx(
                "inline-flex items-center justify-center rounded-sm px-1 py-px text-caption-1-medium whitespace-nowrap",
                isSelected
                  ? "bg-tab-count-selected-background text-accent-600"
                  : "bg-black/10 text-text-primary opacity-50",
              )}
            >
              {count}
            </span>
          )}
        </>
      )}
    </AriaTab>
  );
}
