"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RiArrowDownSFill, RiSearchLine, RiFilter3Line } from "@remixicon/react";
import {
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import type {
    ColumnDef,
    PaginationState,
    SortingState,
} from "@tanstack/react-table";

import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Chip } from "@/components/base/badges/chip";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/base/popover/popover";
import { InputBase } from "@/components/base/input/input";
import { Pagination } from "@/components/base/pagination/pagination";
import { Select, SelectItem } from "@/components/base/select/select";
import {
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
} from "@/components/base/table/table";
import { cx } from "@/utils/cx";
import { Skeleton } from "@/components/app/primitives/skeleton";

const PAGE_SIZE = 10;
const NO_FILTERS: never[] = [];

export interface DataTableFilter<TData> {
    id: string;
    label: string;
    allLabel: string;
    hideWhenSingle?: boolean;
    getValue: (row: TData) => string | string[] | null | undefined;
    getLabel?: (row: TData, value: string) => string | null | undefined;
}

function filterValues(value: string | string[] | null | undefined): (string | null)[] {
    return Array.isArray(value) ? value.length ? value : [null] : [value || null];
}

type FilterOption = { value: string | null; label: string };

export interface DataTableProps<TData> {
    ariaLabel: string;
    columns: ColumnDef<TData>[];
    data: TData[];
    emptyState: ReactNode;
    getRowId: (row: TData) => string;
    getSearchText: (row: TData) => string;
    rowHeaderColumnId: string;
    searchPlaceholder: string;
    columnClassNames?: Record<string, string>;
    filters?: DataTableFilter<TData>[];
    header?: ReactNode | ((filteredCount: number) => ReactNode);
    actions?: ReactNode;
    filterScopeKey?: string;
    isLoading?: boolean;
    isRowExpanded?: (row: TData) => boolean;
    renderExpandedRow?: (row: TData) => ReactNode;
    onRowAction?: (row: TData) => void;
    onFilteredDataChange?: (rows: TData[]) => void;
    selectedRowId?: string | null;
    showShellWhenEmpty?: boolean;
    tableClassName?: string;
}

type FilterWithOptions = { id: string; label: string; allLabel: string; options: FilterOption[] };

function DataTableToolbar({ actions, activeFilters, ariaLabel, filteredCount, header, onQueryChange, query, renderFilter, searchPlaceholder, visibleFilters }: { actions: ReactNode; activeFilters: FilterWithOptions[]; ariaLabel: string; filteredCount: number; header: DataTableProps<unknown>["header"]; onQueryChange: (value: string) => void; query: string; renderFilter: (filter: FilterWithOptions) => ReactNode; searchPlaceholder: string; visibleFilters: FilterWithOptions[] }) {
    const filterTriggerRef = useRef<HTMLButtonElement>(null);
    return <header className="flex w-full flex-col items-start gap-3 px-3 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="w-full min-w-0 sm:w-auto">{typeof header === "function" ? header(filteredCount) : header ?? <div className="flex flex-col justify-center">
                        <p className="text-body-medium whitespace-nowrap text-text-tertiary">Total Results</p>
                        <p className="text-body-medium whitespace-nowrap text-text-primary">{filteredCount.toLocaleString()} results</p>
                    </div>}</div>
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1 sm:justify-end">
                    {visibleFilters.length > 0 && <Popover>
                        <PopoverTrigger><Button ref={filterTriggerRef} variant="secondary" className="h-10 pointer-coarse:h-11" leadingIcon={RiFilter3Line}>Filter{activeFilters.length > 0 ? ` (${String(activeFilters.length)})` : ""}</Button></PopoverTrigger>
                        <PopoverContent isNonModal shouldCloseOnInteractOutside={(target) => !filterTriggerRef.current?.contains(target)} align="end" className="max-h-[min(480px,calc(100dvh-2rem))]">
                            <PopoverTitle className="shrink-0">Filter</PopoverTitle>
                            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">{visibleFilters.map((filter) => <div key={filter.id} className="flex flex-col gap-1.5"><span className="text-body-medium text-text-secondary-strong">{filter.label}</span>{renderFilter(filter)}</div>)}</div>
                        </PopoverContent>
                    </Popover>}
                    <InputBase
                        aria-label={`Search ${ariaLabel}`}
                        className="placeholder:text-foreground-icon-tertiary"
                        fieldClassName="min-w-[153px] flex-1 bg-background-primary-default sm:w-60 sm:min-w-0 sm:flex-none"
                        leadingIcon={RiSearchLine}
                        onChange={(event) => {
                            onQueryChange(event.target.value);
                        }}
                        placeholder={searchPlaceholder}
                        value={query}
                    />
                    {actions}
                    </div>
                </header>;
}

export function DataTable<TData>({
    ariaLabel,
    columns,
    data,
    emptyState,
    getRowId,
    getSearchText,
    rowHeaderColumnId,
    searchPlaceholder,
    columnClassNames = {},
    filters = NO_FILTERS,
    filterScopeKey,
    header,
    actions,
    isLoading = false,
    isRowExpanded,
    renderExpandedRow,
    onRowAction,
    onFilteredDataChange,
    selectedRowId,
    showShellWhenEmpty = false,
    tableClassName,
}: DataTableProps<TData>) {
    "use no memo";
    const [query, setQuery] = useState("");
    const [sorting, setSorting] = useState<SortingState>([]);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
    const [filterState, setFilterState] = useState<{ scope: string | undefined; selected: Record<string, FilterOption | undefined> }>({ scope: filterScopeKey, selected: {} });
    if (filterState.scope !== filterScopeKey) {
        setFilterState({ scope: filterScopeKey, selected: {} });
        setPagination((current) => ({ ...current, pageIndex: 0 }));
    }
    const filterOptions = useMemo(() => filters.map((filter) => {
        const options = new Map<string | null, FilterOption>();
        for (const row of data) {
            for (const value of filterValues(filter.getValue(row))) {
                options.set(value, { value, label: value === null ? "Unassigned" : filter.getLabel?.(row, value) || value });
            }
        }
        const selected = filterState.selected[filter.id];
        if (selected && !options.has(selected.value)) options.set(selected.value, selected);
        return { ...filter, options: [...options.values()].sort((a, b) => a.label.localeCompare(b.label)) };
    }), [data, filters, filterState.selected]);
    const deferredQuery = useDeferredValue(query);
    const searchableData = useMemo(() => data.map((row) => ({ row, searchText: getSearchText(row).toLocaleLowerCase() })), [data, getSearchText]);
    const filteredData = useMemo(() => {
        const terms = deferredQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const activeFilters = filters.filter((filter) => filterState.selected[filter.id]);
        if (!terms.length && !activeFilters.length) return data;
        return searchableData.flatMap(({ row, searchText }) =>
            terms.every((term) => searchText.includes(term)) && activeFilters.every((filter) => filterValues(filter.getValue(row)).some((value) => value === (filterState.selected[filter.id]?.value ?? null))) ? [row] : []);
    }, [data, deferredQuery, searchableData, filters, filterState.selected]);
    useEffect(() => { onFilteredDataChange?.(filteredData); }, [filteredData, onFilteredDataChange]);
    const table = useReactTable({
        columns,
        data: filteredData,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId,
        getSortedRowModel: getSortedRowModel(),
        onPaginationChange: setPagination,
        onSortingChange: setSorting,
        state: { pagination, sorting },
    });
    const headers = table.getHeaderGroups()[0]?.headers ?? [];
    const rows = table.getRowModel().rows;
    const pageCount = table.getPageCount();
    const collectionRows = rows.flatMap((row) => {
        const expandedContent = renderExpandedRow?.(row.original);
        const expanded = isRowExpanded?.(row.original) ?? Boolean(expandedContent);
        return expandedContent
            ? [
                { id: row.id, row, expanded: false, open: expanded, hasExpandedRow: true, content: null },
                { id: `${row.id}-expanded`, row, expanded: true, open: expanded, hasExpandedRow: true, content: expandedContent },
            ]
            : [{ id: row.id, row, expanded: false, open: false, hasExpandedRow: false, content: null }];
    });

    const visibleFilters = filterOptions.filter((filter) => !filter.hideWhenSingle || filter.options.length > 1 || filterState.selected[filter.id]);
    const activeFilters = visibleFilters.filter((filter) => filterState.selected[filter.id]);
    const renderFilter = (filter: FilterWithOptions) => (
        <Select
            aria-label={`Filter ${ariaLabel} by ${filter.label}`}
            className="w-full"
            key={filter.id}
            onChange={(key) => {
                const selected = filter.options.find((option) => JSON.stringify(option.value) === key);
                setFilterState((current) => ({ ...current, selected: { ...current.selected, [filter.id]: selected } }));
                setPagination((current) => ({ ...current, pageIndex: 0 }));
            }}
            triggerClassName="rounded-lg"
            value={filterState.selected[filter.id] ? JSON.stringify(filterState.selected[filter.id]?.value) : "all"}
        >
            <SelectItem id="all" textValue={filter.allLabel}>{filter.allLabel}</SelectItem>
            {filter.options.map((option) => <SelectItem id={JSON.stringify(option.value)} key={JSON.stringify(option.value)} textValue={option.label}>{option.label}</SelectItem>)}
        </Select>
    );

    if (isLoading && data.length === 0) return (
        <section aria-label={ariaLabel} className="w-full">
            <div aria-label={`Loading ${ariaLabel}`} role="status" className="rounded-2xl border border-border-button-white bg-background-secondary-default p-1 pt-3 shadow-sidebar">
                <div aria-hidden className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
                    <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>
                    <Skeleton className="h-9 w-full rounded-2lg sm:w-60" />
                </div>
                <div aria-hidden className="overflow-x-auto rounded-xl border border-border-button-default bg-background-default p-2 dark:border-border-button-white">
                    <table className={cx("w-full table-fixed", tableClassName)}>
                        <thead><tr>{headers.map((header) => <th className={cx("px-6 py-3", columnClassNames[header.column.id], header.column.id === "action" && !header.column.accessorFn && "w-24")} key={header.id}><Skeleton className="h-4 w-2/3" /></th>)}</tr></thead>
                        <tbody>{Array.from({ length: PAGE_SIZE }, (_, index) => <tr key={index}>{headers.map((header) => <td className="border-b border-separator-border px-6 py-4 dark:border-border-button-white" key={header.id}><Skeleton className="h-4 w-3/4" /></td>)}</tr>)}</tbody>
                    </table>
                </div>
            </div>
        </section>
    );

    if (data.length === 0 && !showShellWhenEmpty) return <section aria-label={ariaLabel} className="w-full [&>[data-slot=empty]]:rounded-2xl [&>[data-slot=empty]]:border-2">{emptyState}</section>;

    return (
        <section aria-label={ariaLabel} className="flex w-full flex-col">
            <div className={cx("flex flex-1 flex-col rounded-2xl border border-border-button-white bg-background-secondary-default p-1 pt-3 shadow-sidebar", pageCount > 1 ? "pb-3" : "pb-1")}>
                <DataTableToolbar actions={actions} activeFilters={activeFilters} ariaLabel={ariaLabel} filteredCount={filteredData.length} header={header} onQueryChange={(value) => { setQuery(value); setPagination((current) => ({ ...current, pageIndex: 0 })); }} query={query} renderFilter={renderFilter} searchPlaceholder={searchPlaceholder} visibleFilters={visibleFilters} />
                {activeFilters.length > 0 && <div aria-label="Active filters" className="flex flex-wrap gap-2 px-3 pb-3">
                    {activeFilters.map((filter) => <Chip key={filter.id} className="max-w-full gap-2 rounded-lg py-1 ps-3 pe-1 text-body-2-medium normal-case">
                        <span className="min-w-0 break-words whitespace-normal"><span className="text-text-secondary">{filter.label}:</span> <span className="text-text-primary">{filterState.selected[filter.id]?.label}</span></span>
                        <CloseButton aria-label={`Remove ${filter.label} filter`} size="sm" className="pointer-coarse:size-11" onClick={() => {
                            setFilterState((current) => ({ ...current, selected: { ...current.selected, [filter.id]: undefined } }));
                            setPagination((current) => ({ ...current, pageIndex: 0 }));
                        }} />
                    </Chip>)}
                </div>}
                {collectionRows.length > 0 ? <Table
                    aria-label={ariaLabel}
                    className={cx(
                        "min-w-min table-auto flex-1 border-separate! border-spacing-0! bg-background-default [--color-separator-border:var(--color-separator-border-strong)] dark:[--color-separator-border:var(--color-border-button-white)] [&_tbody_td]:wrap-anywhere [&_tbody_td]:border-b [&_tbody_td]:border-separator-border [&_thead_th]:text-text-secondary-strong [&_thead_th:first-child]:rounded-s-lg [&_thead_th:first-child]:border-s [&_thead_th:first-child]:border-separator-border [&_thead_th:last-child]:rounded-e-lg [&_thead_th:last-child]:border-e [&_thead_th:last-child]:border-separator-border",
                        tableClassName,
                    )}
                    containerClassName="flex rounded-xl border border-border-button-default dark:border-border-button-white  bg-background-default py-2 before:w-2 before:shrink-0 before:content-[''] after:w-2 after:shrink-0 after:content-['']"
                    onSortChange={(descriptor) => {
                        const column = String(descriptor.column);
                        setSorting((current) => current[0]?.id !== column
                            ? [{ id: column, desc: true }]
                            : current[0].desc
                                ? [{ id: column, desc: false }]
                                : []);
                    }}
                    size="md"
                    sortDescriptor={sorting[0] ? {
                        column: sorting[0].id,
                        direction: sorting[0].desc ? "descending" : "ascending",
                    } : undefined}
                >
                    <TableHeader>
                        {headers.map((header) => {
                            const sorted = header.column.getIsSorted();
                            const label = flexRender(header.column.columnDef.header, header.getContext());
                            const sortableLabel = header.column.getCanSort() ? (
                                <span className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                                    {label}
                                    <RiArrowDownSFill
                                        aria-hidden
                                        className={cx("size-4 shrink-0 transition-[transform,color] duration-150", sorted === "asc" && "rotate-180", sorted ? "text-text-secondary" : "text-text-tertiary")}
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={3}
                                    />
                                </span>
                            ) : label;
                            return (
                                <TableColumn
                                    allowsSorting={header.column.getCanSort()}
                                    className={cx(columnClassNames[header.column.id], header.column.id === "action" && !header.column.accessorFn && "w-24 whitespace-nowrap text-center")}
                                    id={header.id}
                                    isRowHeader={header.column.id === rowHeaderColumnId}
                                    key={header.id}
                                    textValue={typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.id}
                                >
                                    {sortableLabel}
                                </TableColumn>
                            );
                        })}
                    </TableHeader>
                    <TableBody items={collectionRows}>
                        {(item) => item.expanded ? (
                            <TableRow className={cx(!item.open && "[&>td]:border-b-0!")} id={item.id}>
                                <TableCell className="bg-background-secondary-default p-0!" colSpan={headers.length}>
                                    <span className="sr-only">{ariaLabel} details</span>
                                    <div aria-hidden={!item.open} className={cx("grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", item.open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                                        <div className="overflow-hidden"><div className="px-6 py-5">{item.content}</div></div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            <TableRow className={cx(onRowAction && "cursor-pointer data-hovered:bg-background-primary-hover", selectedRowId === item.id && "bg-background-primary-active data-hovered:bg-background-primary-active")} id={item.id} onAction={onRowAction ? () => { onRowAction(item.row.original); } : undefined}>
                                {item.row.getVisibleCells().map((cell) => {
                                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                                    return (
                                        <TableCell className={cx(columnClassNames[cell.column.id], cell.column.id === "action" && !cell.column.accessorFn && "w-24 whitespace-nowrap text-center")} key={cell.id}>{content}</TableCell>
                                    );
                                })}
                            </TableRow>
                        )}
                    </TableBody>
                </Table> : <div className="flex flex-1 flex-col [&>[data-slot=empty]]:rounded-xl [&>[data-slot=empty]]:border-2 [&>[data-slot=empty]]:border-border-button-default dark:[&>[data-slot=empty]]:border-border-button-white [&_[data-slot=empty-content]]:hidden">{emptyState}</div>}
                {pageCount > 1 ? (
                    <Pagination
                        className="px-3 pt-3"
                        onChange={(page) => { table.setPageIndex(page - 1); }}
                        page={pagination.pageIndex + 1}
                        totalPages={pageCount}
                    />
                ) : null}
            </div>
        </section>
    );
}
