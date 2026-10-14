"use client";

import { Children, createContext, useContext, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  Autocomplete,
  SearchField,
  Button as AriaButton,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
} from "react-aria-components";
import type {
  ListBoxItemProps as AriaListBoxItemProps,
  SelectProps as AriaSelectProps,
  SelectValueRenderProps as AriaSelectValueRenderProps,
} from "react-aria-components";
import {
  RiArrowDownSLine as IconChevronDown,
  RiAddCircleFill as IconCreate,
  RiCheckLine as IconSelected,
  RiSearchLine as IconSearch,
} from "@remixicon/react";

import { CloseButton } from "@/components/base/buttons/close-button";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { PopoverSurface } from "@/components/base/popover/popover";
import { cx } from "@/utils/cx";

export type SelectSize = "sm" | "md";

type CreatableOption = {
  getLabel: (query: string) => string | null;
  onCreate: (query: string) => Promise<void>;
  /** Rewrites the search text as it is typed, e.g. stripping spaces from size codes. */
  normalizeQuery?: (query: string) => string;
};

const SelectSizeContext = createContext<SelectSize>("md");

export interface SelectProps<T extends object, M extends "single" | "multiple" = "single">
  extends Omit<AriaSelectProps<T, M>, "children"> {
  className?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  alwaysSearchable?: boolean;
  creatable?: CreatableOption;
  size?: SelectSize;
  children: ReactNode;
  items?: Iterable<T>;
  renderValue?: ReactNode | ((values: AriaSelectValueRenderProps<T>) => ReactNode);
  ref?: Ref<HTMLDivElement>;
}

export function Select<T extends object, M extends "single" | "multiple" = "single">({
  className,
  triggerClassName,
  popoverClassName,
  size = "md",
  searchPlaceholder = "Search options",
  emptyMessage = "No options found.",
  alwaysSearchable = false,
  creatable,
  children,
  items,
  renderValue,
  ref,
  ...props
}: SelectProps<T, M>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const isOpen = props.isOpen ?? localOpen;
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState("");
  function setIsOpen(open: boolean) {
    if (creatingRef.current) return;
    setLocalOpen(open);
    if (!open) { setQuery(""); setCreationError(""); }
    props.onOpenChange?.(open);
  }
  const [query, setQuery] = useState("");
  const [touch, setTouch] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const searchable = alwaysSearchable || Boolean(creatable) || (items ? Array.from(items).length : Children.count(children)) > 6;
  const createLabel = query.trim() ? creatable?.getLabel(query.trim()) : null;
  async function create() {
    if (!creatable || !createLabel || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreationError("");
    try {
      await creatable.onCreate(query.trim());
      creatingRef.current = false;
      setIsOpen(false);
      requestAnimationFrame(() => { triggerRef.current?.focus(); });
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Could not save. Please try again.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  return (
    <AriaSelect
      ref={ref}
      {...props}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      className={cx("group flex flex-col", className)}
    >
      {({ isOpen: open }) => (
        <div onKeyDownCapture={(event) => { if (event.key === "Escape" && isOpen) { event.stopPropagation(); setIsOpen(false); } }}>
          <AriaButton
            ref={triggerRef}
            data-keyboard={keyboard}
            onPressStart={(event) => { setTouch(event.pointerType === "touch"); setKeyboard(event.pointerType === "keyboard"); if (open && event.pointerType !== "touch" && event.pointerType !== "keyboard") setIsOpen(false); }}
            aria-invalid={props.isInvalid || undefined}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            className={cx(
              "flex w-full cursor-pointer items-center justify-between rounded-2lg",
              "border border-border-button-default bg-background-primary-default shadow-xs",
              "text-text-primary",
              "transition-[background-color,border-color,box-shadow,color] duration-(--button-transition-ms) ease data-[keyboard=true]:transition-none motion-reduce:transition-none",
              props.isInvalid && "border-border-error bg-background-tertiary-error",
              "enabled:hover:border-border-button-hover enabled:hover:bg-background-primary-hover",
              "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-input-disabled-background disabled:text-input-disabled-text disabled:shadow-none",
              size === "sm" ? "gap-1 px-[7px] py-1 text-body-2-medium" : "h-10 gap-1.5 px-2.5 py-2 text-body-regular pointer-coarse:h-11",
              triggerClassName,
            )}
          >
            <AriaSelectValue className={cx("flex min-w-0 items-center truncate", props.isDisabled ? "text-input-disabled-text" : "data-[placeholder]:text-text-secondary-strong", size === "sm" ? "gap-1" : "gap-[5px]")}>{renderValue ?? (({ isPlaceholder, selectedText }) => isPlaceholder ? props.placeholder : selectedText)}</AriaSelectValue>
            <IconChevronDown className={cx("shrink-0 transition-transform", props.isDisabled ? "text-input-disabled-text" : "text-text-secondary", "duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", size === "sm" ? "size-3.5" : "size-4", open && "rotate-180", keyboard && "transition-none")} />
          </AriaButton>
          <PopoverSurface variant="select" triggerRef={triggerRef} className={popoverClassName}>
            <Autocomplete inputValue={query} onInputChange={(value) => { if (!creatingRef.current) { setQuery(creatable?.normalizeQuery ? creatable.normalizeQuery(value) : value); setCreationError(""); } }} filter={(text, input) => text.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())}>
              {searchable && <SearchField isDisabled={creating} autoFocus={!touch} aria-label={searchPlaceholder} className="mb-2 shrink-0">
                <InputBase className="[&::-webkit-search-cancel-button]:hidden" fieldClassName="rounded-lg bg-background-secondary-default" leadingIcon={IconSearch} placeholder={searchPlaceholder} trailingAddon={query ? <CloseButton aria-label="Clear search" onClick={() => { setQuery(""); }} size="xs" /> : null} />
              </SearchField>}
              <AriaListBox autoFocus={keyboard ? undefined : false} items={items} renderEmptyState={() => <div className="py-6 text-center text-body-regular text-text-secondary-strong">{emptyMessage}</div>} className="flex min-h-0 max-h-[240px] flex-col gap-1 overflow-auto overscroll-contain outline-none">
                <SelectSizeContext.Provider value={size}>{children}</SelectSizeContext.Provider>
              </AriaListBox>
            </Autocomplete>
            {createLabel && <Button type="button" variant="ghost" leadingIcon={IconCreate} className="justify-start [&>span]:block [&>span]:min-w-0 [&>span]:shrink [&>span]:truncate" disabled={creating} loading={creating} onClick={() => { void create(); }}>{createLabel}</Button>}
            {creationError && <p role="alert" className="text-body-2-regular text-text-error-primary">{creationError}</p>}
          </PopoverSurface>
        </div>
      )}
    </AriaSelect>
  );
}

export interface SelectItemProps extends Omit<AriaListBoxItemProps, "children"> {
  children?: ReactNode;
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  const size = useContext(SelectSizeContext);
  return (
    <AriaListBoxItem
      {...props}
      textValue={props.textValue ?? (typeof children === "string" ? children : undefined)}
      className={(state) => cx(
        "flex min-h-10 pointer-coarse:min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none select-none",
        size === "sm" ? "px-2 py-1.5 text-body-2-medium" : "text-body-medium",
        (state.isHovered || state.isFocusVisible) && "bg-background-primary-hover text-text-primary",
        state.isDisabled && "cursor-not-allowed text-text-disabled",
        typeof className === "function" ? className(state) : className,
      )}
    >
      {({ isSelected }) => <><span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span><span className={cx("flex size-4 shrink-0 items-center justify-center text-accent-600 dark:text-accent-400", !isSelected && "opacity-0")}><IconSelected aria-hidden className="size-4" /></span></>}
    </AriaListBoxItem>
  );
}

export type SelectOption = {
  id: string;
  label: string;
  isDisabled?: boolean;
};

type SearchSelectCommonProps = {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  emptyMessage?: string;
  isDisabled?: boolean;
  isInvalid?: boolean;
  isRequired?: boolean;
  name?: string;
  options: readonly SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  size?: SelectSize;
};

export type SearchableSelectProps = SearchSelectCommonProps & {
  alwaysSearchable?: boolean;
  creatable?: CreatableOption;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
};

export function SearchableSelect({ options, onChange, creatable, ...props }: SearchableSelectProps) {
  return <Select {...props} creatable={creatable ? { ...creatable, getLabel: (query) => options.some((option) => option.label.trim().toLocaleLowerCase().includes(query.toLocaleLowerCase())) ? null : creatable.getLabel(query) } : undefined} disabledKeys={options.length ? options.flatMap((option) => option.isDisabled ? [option.id] : []) : ["__empty__"]} onChange={(value) => { onChange?.(value == null ? null : String(value)); }}>
    {options.length === 0 && (props.alwaysSearchable || creatable) ? <SelectItem id="__empty__" textValue="">{props.emptyMessage ?? "No options found."}</SelectItem> : options.map((option) => <SelectItem key={option.id} id={option.id} textValue={option.label}><span className="truncate">{option.label}</span></SelectItem>)}
  </Select>;
}
