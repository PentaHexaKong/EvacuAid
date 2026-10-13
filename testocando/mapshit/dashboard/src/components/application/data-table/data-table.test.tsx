import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, expect, test, vi } from "vitest";

import { DataTable, type DataTableFilter, type DataTableProps } from "@/components/application/data-table/data-table";

type Person = {
    id: string;
    name: string;
    team: string;
    score: number;
};

const people: Person[] = [
    { id: "1", name: "Ada", team: "Finance", score: 9 },
    { id: "2", name: "Bima", team: "Operations", score: 4 },
    { id: "3", name: "Citra", team: "Sales", score: 7 },
    { id: "4", name: "Danu", team: "Finance", score: 2 },
    { id: "5", name: "Eka", team: "Operations", score: 5 },
    { id: "6", name: "Farah", team: "Sales", score: 8 },
    { id: "7", name: "Gita", team: "Finance", score: 1 },
    { id: "8", name: "Hadi", team: "Operations", score: 6 },
    { id: "9", name: "Intan", team: "Sales", score: 3 },
];

const paginatedPeople = [...people.slice(0, 8), { id: "10", name: "Joko", team: "Finance", score: 2 }, { id: "11", name: "Kiki", team: "Operations", score: 4 }, ...people.slice(8)];

const columns: ColumnDef<Person>[] = [
    { accessorKey: "name", header: "Name" },
    { accessorKey: "team", header: "Team" },
    { accessorKey: "score", header: "Score" },
    { id: "action", header: "Action", enableSorting: false, cell: ({ row }) => <button type="button">Edit {row.original.name}</button> },
];

afterEach(cleanup);

const filters: DataTableFilter<Person>[] = [
    { id: "status", label: "Status", allLabel: "All statuses", getValue: (person) => person.score > 4 ? "active" : "inactive", getLabel: (person) => person.score > 4 ? "Active" : "Inactive" },
    { id: "team", label: "Team", allLabel: "All teams", getValue: (person) => person.team || null },
];

function FilteredPeople(props: Partial<DataTableProps<Person>>) {
    return <DataTable ariaLabel="People" columns={columns} data={people} emptyState={<p>No people found.</p>} filters={filters} getRowId={(person) => person.id} getSearchText={(person) => `${person.name} ${person.team}`} rowHeaderColumnId="name" searchPlaceholder="Search people" {...props} />;
}

async function selectFilter(label: string, option: string) {
    const user = userEvent.setup();
    if (!screen.queryByRole("dialog", { name: "Filter" })) await user.click(screen.getByRole("button", { name: /^Filter(?: \(\d+\))?$/ }));
    await user.click(screen.getByRole("button", { name: new RegExp(`Filter People by ${label}`) }));
    await user.click(await screen.findByRole("option", { name: option }));
    const dismiss = screen.getAllByRole("button", { name: "Dismiss" })[0];
    if (!dismiss) throw new Error("Filter dismiss button is missing");
    await user.click(dismiss);
}

test("combines exact categorical matches with search and clears filters without changing sorting", async () => {
    render(<FilteredPeople />);
    await userEvent.setup().click(screen.getByRole("columnheader", { name: "Name" }));
    await selectFilter("Status", "Active");
    expect(screen.getByText("5 results")).toBeInTheDocument();
    expect(screen.queryByText("Bima")).not.toBeInTheDocument();
    await selectFilter("Team", "Finance");
    expect(screen.getByText("1 results")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "Bima" } });
    expect(screen.getByText("0 results")).toBeInTheDocument();
    expect(screen.getByText("No people found.")).toBeInTheDocument();
    await selectFilter("Team", "All teams");
    await selectFilter("Status", "All statuses");
    expect(screen.getByText("Bima")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "" } });
    expect(screen.getByText("9 results")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending");
});

test("builds sorted options from every source row and resets pagination on selection", async () => {
    render(<FilteredPeople data={paginatedPeople.map((person) => person.id === "9" ? { ...person, team: "Unique team" } : person)} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await selectFilter("Team", "Unique team");
    expect(screen.getByText("Intan")).toBeInTheDocument();
    expect(screen.getByText("1 results")).toBeInTheDocument();
    await selectFilter("Team", "All teams");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "no match" } });
    await userEvent.setup().click(screen.getByRole("button", { name: /^Filter(?: \(\d+\))?$/ }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Filter People by Team/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["All teams", "Finance", "Operations", "Sales", "Unique team"]);
});

test("filters missing relationships and retains a selected option after its records disappear", async () => {
    const { rerender } = render(<FilteredPeople data={people.slice(0, 2).map((person) => person.id === "1" ? { ...person, team: "" } : person)} />);
    await selectFilter("Team", "Unassigned");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Bima")).not.toBeInTheDocument();
    rerender(<FilteredPeople data={people.slice(1, 2)} />);
    expect(screen.getByText("0 results")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Filter(?: \(\d+\))?$/ }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Filter People by Team/ }));
    expect(screen.getByRole("option", { name: "Unassigned" })).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(screen.getByRole("option", { name: "All teams" }));
    expect(screen.getByText("Bima")).toBeInTheDocument();
});

test("clears selections and pagination when the filter scope changes", async () => {
    const { rerender } = render(<FilteredPeople data={paginatedPeople} filterScopeKey="company-a" />);
    await selectFilter("Status", "Inactive");
    rerender(<FilteredPeople data={paginatedPeople} filterScopeKey="company-b" />);
    expect(screen.getByText("11 results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Status filter" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    rerender(<FilteredPeople data={paginatedPeople} filterScopeKey="company-c" />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Intan")).not.toBeInTheDocument();
});

function renderPeople(overrides: Partial<React.ComponentProps<typeof DataTable<Person>>> = {}) {
    return render(
        <DataTable
            ariaLabel="People"
            columnClassNames={{ action: "text-right" }}
            columns={columns}
            data={people}
            emptyState={<p>No people found.</p>}
            getRowId={(person) => person.id}
            getSearchText={(person) => `${person.name} ${person.team} ${String(person.score)}`}
            rowHeaderColumnId="name"
            searchPlaceholder="Search people"
            {...overrides}
        />,
    );
}

test("shows ten rows per page and moves to the remaining rows", () => {
    renderPeople({ data: paginatedPeople });
    expect(screen.getAllByRole("button", { name: /^Edit / })).toHaveLength(10);

    expect(screen.getByRole("region", { name: "People" })).toHaveClass("w-full");
    expect(screen.getByRole("grid", { name: "People" }).parentElement?.parentElement).toHaveClass("border-border-button-white", "bg-background-secondary-default", "pb-3", "shadow-sidebar");
    expect(screen.getByRole("grid", { name: "People" }).parentElement?.parentElement).not.toHaveClass("border-border-table");
    expect(screen.getByRole("grid", { name: "People" })).toHaveClass("table-auto", "border-separate!", "[&_thead_th:first-child]:rounded-s-lg", "[&_thead_th:last-child]:rounded-e-lg");
    expect(screen.getByRole("grid", { name: "People" })).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Intan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Intan")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Action" })).toHaveClass("w-24", "whitespace-nowrap", "text-center");
    expect(screen.getByRole("columnheader", { name: "Action" })).not.toHaveClass("text-right");
    expect(screen.getByRole("button", { name: "Edit Intan" }).closest("td")).toHaveClass("w-24", "whitespace-nowrap", "text-center");
});

test("removes the footer spacing when pagination is not needed", () => {
    renderPeople({ data: people.slice(0, 1) });

    expect(screen.getByRole("grid", { name: "People" }).parentElement).toHaveClass("flex", "overflow-x-auto", "rounded-xl", "bg-background-default", "py-2", "before:w-2", "after:w-2");
    expect(screen.getByRole("grid", { name: "People" }).parentElement).not.toHaveClass("overflow-hidden", "p-2");
    expect(screen.getByRole("grid", { name: "People" })).toHaveClass("table-auto", "[&_tbody_td]:wrap-anywhere", "[&_tbody_td]:border-b", "bg-background-default");
    expect(screen.getByRole("grid", { name: "People" }).parentElement?.parentElement).toHaveClass("pb-1");
    expect(screen.getByRole("grid", { name: "People" }).parentElement?.parentElement).not.toHaveClass("pb-3");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
});

test("renders the results toolbar in the outer shell header", () => {
    renderPeople();

    const innerTable = screen.getByRole("grid", { name: "People" }).parentElement;
    const outerShell = innerTable?.parentElement;
    expect(outerShell).toContainElement(screen.getByText("Total Results"));
    expect(outerShell).toContainElement(screen.getByPlaceholderText("Search people"));
    expect(innerTable).not.toContainElement(screen.getByText("Total Results"));
    expect(innerTable).not.toContainElement(screen.getByPlaceholderText("Search people"));
});

test("filters rows using the supplied searchable text", () => {
    renderPeople();

    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "Finance" } });

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Danu")).toBeInTheDocument();
    expect(screen.getByText("Gita")).toBeInTheDocument();
    expect(screen.queryByText("Bima")).not.toBeInTheDocument();
    expect(screen.getByText("3 results")).toBeInTheDocument();
});

test("indexes searchable text once and matches query words in any order", async () => {
    const getSearchText = vi.fn((person: Person) => `${person.name} ${person.team} ${String(person.score)}`);
    renderPeople({ getSearchText });

    expect(getSearchText).toHaveBeenCalledTimes(people.length);
    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "9 finance" } });

    await waitFor(() => { expect(screen.getByText("1 results")).toBeInTheDocument(); });
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(getSearchText).toHaveBeenCalledTimes(people.length);
});

test("cycles column sorting through descending, ascending, and inactive", async () => {
    renderPeople();
    const user = userEvent.setup();
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    const sortChevron = nameHeader.querySelector("svg");

    expect(sortChevron).toHaveClass("size-4");
    expect(sortChevron).toHaveClass("text-text-tertiary");
    expect(sortChevron).not.toHaveClass("text-text-secondary");
    expect(sortChevron).not.toHaveClass("size-3.5", "size-6");
    expect(sortChevron).toHaveAttribute("stroke", "currentColor");
    expect(sortChevron).toHaveAttribute("stroke-linecap", "round");
    expect(sortChevron).toHaveAttribute("stroke-linejoin", "round");
    expect(sortChevron).toHaveAttribute("stroke-width", "3");

    await user.click(nameHeader);

    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    expect(sortChevron).toHaveClass("text-text-secondary");
    let firstRow = within(screen.getByRole("grid", { name: "People" })).getAllByRole("row").at(1);
    if (!firstRow) throw new Error("The first data row is missing");
    expect(within(firstRow).getByText("Intan")).toBeInTheDocument();

    await user.click(nameHeader);

    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    firstRow = within(screen.getByRole("grid", { name: "People" })).getAllByRole("row").at(1);
    if (!firstRow) throw new Error("The first data row is missing");
    expect(within(firstRow).getByText("Ada")).toBeInTheDocument();

    await user.click(nameHeader);

    expect(nameHeader).toHaveAttribute("aria-sort", "none");
    expect(sortChevron).toHaveClass("text-text-tertiary");
    firstRow = within(screen.getByRole("grid", { name: "People" })).getAllByRole("row").at(1);
    if (!firstRow) throw new Error("The first data row is missing");
    expect(within(firstRow).getByText("Ada")).toBeInTheDocument();
});

test("does not render row selection controls", () => {
    renderPeople();

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("renders the supplied empty state after filtering", () => {
    renderPeople();

    fireEvent.change(screen.getByPlaceholderText("Search people"), { target: { value: "missing" } });

    expect(screen.getByText("No people found.")).toBeInTheDocument();
    expect(screen.getByText("No people found.").parentElement).toHaveClass("[&>[data-slot=empty]]:rounded-xl", "[&_[data-slot=empty-content]]:hidden");
    expect(screen.queryByRole("grid", { name: "People" })).not.toBeInTheDocument();
});

test("shows skeletons during initial loading and keeps loaded rows during refresh", () => {
    const { rerender } = render(<FilteredPeople data={[]} isLoading />);

    const loading = screen.getByRole("status", { name: "Loading People" });
    expect(loading.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText("No people found.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 results")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search people")).not.toBeInTheDocument();

    rerender(<FilteredPeople data={[]} isLoading={false} />);
    expect(screen.queryByRole("status", { name: "Loading People" })).not.toBeInTheDocument();
    expect(screen.getByText("No people found.")).toBeInTheDocument();

    rerender(<FilteredPeople isLoading />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading People" })).not.toBeInTheDocument();
});

test("replaces the whole table when no source records exist", () => {
    renderPeople({ data: [] });

    expect(screen.getByText("No people found.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "People" })).toHaveClass("[&>[data-slot=empty]]:rounded-2xl");
    expect(screen.queryByText("Total Results")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search people")).not.toBeInTheDocument();
  expect(screen.queryByRole("grid", { name: "People" })).not.toBeInTheDocument();
});

test("keeps the existing glass shell for an opted-in empty table", () => {
    renderPeople({ data: [], showShellWhenEmpty: true });

    expect(screen.getByText("0 results").closest("header")?.parentElement).toHaveClass("rounded-2xl", "bg-background-secondary-default", "shadow-sidebar");
    expect(screen.getByText("No people found.")).toBeInTheDocument();
});

test("renders optional expanded content as an additional table row", () => {
    renderPeople({
        renderExpandedRow: (person) => person.id === "1" ? <p>Ada details</p> : null,
    });

    expect(screen.getByText("Ada details")).toBeInTheDocument();
});

test("keeps the data-row border and hides the closed detail-row border", () => {
    renderPeople({
        data: paginatedPeople,
        isRowExpanded: () => false,
        renderExpandedRow: (person) => <p>{person.name} details</p>,
    });

    expect(screen.getByText("Hadi").closest("tr")).not.toHaveClass("[&>td]:border-b-0!");
    expect(screen.getByText("Hadi details").closest("tr")).toHaveClass("[&>td]:border-b-0!");
    expect(screen.getByRole("navigation", { name: "Pagination" })).not.toHaveClass("border-t", "border-border-table");
});

test("updates rows when the supplied data changes", () => {
    const view = renderPeople({ data: people.slice(0, 1) });

    view.rerender(
        <DataTable
            ariaLabel="People"
            columns={columns}
            data={people.slice(0, 2)}
            emptyState={<p>No people found.</p>}
            getRowId={(person) => person.id}
            getSearchText={(person) => `${person.name} ${person.team} ${String(person.score)}`}
            rowHeaderColumnId="name"
            searchPlaceholder="Search people"
        />,
    );

    expect(screen.getByText("Bima")).toBeInTheDocument();
});

test("custom header replaces the results summary even when empty", () => {
    render(<FilteredPeople data={[]} showShellWhenEmpty header={<h2>Recent people</h2>} />);
    expect(screen.getByRole("heading", { name: "Recent people" })).toBeInTheDocument();
    expect(screen.queryByText("Total Results")).not.toBeInTheDocument();
    expect(screen.queryByText("0 results")).not.toBeInTheDocument();
});

test("discloses additional filters, removes their chips, and resets them with scope", async () => {
    const user = userEvent.setup();
    const extraFilters = filters.map((filter) => filter.id === "team" ? { ...filter, hideWhenSingle: true } : filter);
    const { rerender } = render(<FilteredPeople filters={extraFilters} filterScopeKey="a" />);
    expect(screen.queryByRole("button", { name: /Filter People by Team/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await selectFilter("Team", "Finance");
    expect(screen.getByRole("button", { name: "Filter (1)" })).toBeInTheDocument();
    expect(screen.getByText("3 results")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Team filter" }));
    expect(screen.getByText("9 results")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await selectFilter("Team", "Finance");
    rerender(<FilteredPeople filters={extraFilters} filterScopeKey="b" data={people.filter((person) => person.team === "Finance")} />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByRole("button", { name: /Filter People by Team/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Team filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter People by Status/ })).toBeInTheDocument();
});


test("puts all selectors in one dropdown by default", async () => {
    const user = userEvent.setup();
    render(<FilteredPeople />);
    expect(screen.queryByRole("button", { name: /Filter People by/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search People" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("button", { name: /Filter People by Status/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter People by Team/ })).toBeInTheDocument();
});


test("matches any assigned branch and clears the branch chip", async () => {
    render(<FilteredPeople data={people.slice(0, 2)} filters={[{ id: "branch", label: "Branch", allLabel: "All branches", getValue: (person) => person.id === "1" ? ["a", "b"] : ["c"], getLabel: (_person, value) => `Branch ${value}` }]} />);
    await selectFilter("Branch", "Branch b");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Bima")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Branch filter" }));
    expect(screen.getByText("Bima")).toBeInTheDocument();
});

test("filter trigger closes an open nonmodal popover with one click", async () => {
    const user = userEvent.setup();
    render(<FilteredPeople />);
    const trigger = screen.getByRole("button", { name: "Filter" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
    await user.click(trigger);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument(); });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("keeps action data left aligned while display actions stay centered", () => {
    const { rerender } = render(<FilteredPeople columns={[{ accessorKey: "name", header: "Name" }, { id: "action", accessorKey: "team", header: "Action" }]} data={people.slice(0, 1)} />);
    expect(screen.getByRole("gridcell", { name: "Finance" })).not.toHaveClass("text-center");
    expect(screen.getByRole("columnheader", { name: "Action" })).not.toHaveClass("text-center");
    rerender(<FilteredPeople data={people.slice(0, 1)} />);
    expect(screen.getByRole("gridcell", { name: "Edit Ada" })).toHaveClass("text-center");
});
