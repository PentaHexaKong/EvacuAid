"use client";

import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";

import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

export interface PaginationProps {
    page: number;
    totalPages: number;
    onChange: (page: number) => void;
    siblingCount?: number;
    className?: string;
}

const DOTS = "dots";

function range(start: number, end: number) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function paginationRange(current: number, total: number, sibling: number) {
    if (sibling * 2 + 5 >= total) return range(1, total);

    const leftSibling = Math.max(current - sibling, 1);
    const rightSibling = Math.min(current + sibling, total);
    const showLeftDots = leftSibling > 2;
    const showRightDots = rightSibling < total - 2;

    if (!showLeftDots && showRightDots) return [...range(1, 3 + 2 * sibling), DOTS, total];
    if (showLeftDots && !showRightDots) return [1, DOTS, ...range(total - (2 + 2 * sibling), total)];
    return [1, DOTS, ...range(leftSibling, rightSibling), DOTS, total];
}

const pageCell = "flex size-8 shrink-0 items-center justify-center rounded-lg text-body-medium";

export function Pagination({
    page,
    totalPages,
    onChange,
    siblingCount = 1,
    className,
}: PaginationProps) {
    if (totalPages <= 1) return null;
    const pages = paginationRange(page, totalPages, siblingCount);

    return (
        <nav
            aria-label="Pagination"
            className={cx("flex w-full items-center justify-between gap-2", className)}
        >
            <Button
                disabled={page <= 1}
                leadingIcon={RiArrowLeftLine}
                onClick={() => { onChange(page - 1); }}
                size="small"
                variant="secondary"
            >
                Previous
            </Button>
            <ul className="flex min-w-0 items-center gap-0.5">
                {pages.map((item, index) => item === DOTS ? (
                    <li
                        aria-hidden
                        className={cx(pageCell, "text-text-tertiary")}
                        key={`dots-${String(index)}`}
                    >
                        …
                    </li>
                ) : (
                    <li key={item}>
                        <button
                            aria-current={item === page ? "page" : undefined}
                            aria-label={`Go to page ${String(item)}`}
                            className={cx(
                                pageCell,
                                "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring",
                                item === page
                                    ? "border border-border-button-default bg-background-primary-default text-text-primary shadow-xs"
                                    : "text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary",
                            )}
                            onClick={() => { onChange(Number(item)); }}
                            type="button"
                        >
                            {item}
                        </button>
                    </li>
                ))}
            </ul>
            <Button
                disabled={page >= totalPages}
                onClick={() => { onChange(page + 1); }}
                size="small"
                trailingIcon={RiArrowRightLine}
                variant="secondary"
            >
                Next
            </Button>
        </nav>
    );
}
