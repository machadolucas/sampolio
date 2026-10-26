// @vitest-environment jsdom
import { createRef, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, Column, type DataTableExpandedRows } from "./data-table";

const records = [
  { id: "alex", name: "Alex", amount: 120 },
  { id: "sam", name: "Sam", amount: 25 },
  { id: "third", name: "Alex Savings", amount: 400 },
];

function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).queryByTestId("name")?.textContent)
    .filter(Boolean);
}

describe("TanStack data table behavior", () => {
  it("sorts by raw numeric values and exposes sort direction", () => {
    render(
      <DataTable value={records}>
        <Column
          field="name"
          header="Name"
          body={(row) => <span data-testid="name">{row.name}</span>}
        />
        <Column field="amount" header="Amount" sortable />
      </DataTable>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(names()).toEqual(["Sam", "Alex", "Alex Savings"]);
    expect(
      screen.getByRole("columnheader", { name: "Amount" }),
    ).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(names()).toEqual(["Alex Savings", "Alex", "Sam"]);
  });

  it("paginates and changes page size without losing rows", () => {
    render(
      <DataTable value={records} paginator rows={2} rowsPerPageOptions={[2, 3]}>
        <Column
          field="name"
          header="Name"
          body={(row) => <span data-testid="name">{row.name}</span>}
        />
      </DataTable>,
    );
    expect(names()).toEqual(["Alex", "Sam"]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(names()).toEqual(["Alex Savings"]);
    expect(screen.getByRole("button", { name: "Last" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(names()).toEqual(["Alex", "Sam"]);
    fireEvent.click(screen.getByRole("button", { name: "Last" }));
    expect(names()).toEqual(["Alex Savings"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Go to page" }), {
      target: { value: "0" },
    });
    expect(names()).toEqual(["Alex", "Sam"]);
    expect(screen.getByRole("button", { name: "First" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), {
      target: { value: "3" },
    });
    expect(names()).toEqual(["Alex", "Sam", "Alex Savings"]);
  });

  it("keeps controlled expansion keyed to the original record", async () => {
    function Example() {
      const [expanded, setExpanded] = useState<DataTableExpandedRows>({});
      const [masked, setMasked] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setMasked((value) => !value)}>
            Toggle masking
          </button>
          <DataTable
            key={String(masked)}
            value={records.map((record) => ({ ...record }))}
            dataKey="id"
            expandedRows={expanded}
            onRowToggle={(event) => setExpanded(event.data)}
            rowExpansionTemplate={(row) => <p>Details for {row.name}</p>}
          >
            <Column expander />
            <Column field="name" />
          </DataTable>
        </>
      );
    }
    render(<Example />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Expand row" })[1]);
    });
    expect(screen.getByText("Details for Sam")).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle masking" }));
    });
    expect(screen.getByText("Details for Sam")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Collapse row" }));
    expect(screen.queryByText("Details for Sam")).not.toBeInTheDocument();
  });

  it("supports keyboard selection and leaves inner actions independent", () => {
    const select = vi.fn();
    render(
      <DataTable
        value={records}
        selectionMode="single"
        onSelectionChange={select}
      >
        <Column field="name" />
        <Column body={() => <button type="button">Edit</button>} />
      </DataTable>,
    );
    const row = screen.getAllByRole("row")[1];
    fireEvent.keyDown(row, { key: "Enter" });
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ value: records[0] }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("keeps pinned header, body and footer order identical", () => {
    render(
      <DataTable value={[records[0]]}>
        <Column field="amount" header="Center" footer="Center total" />
        <Column
          field="id"
          header="End"
          footer="End total"
          frozen
          alignFrozen="right"
        />
        <Column field="name" header="Start" footer="Start total" frozen />
      </DataTable>,
    );
    const rows = screen.getAllByRole("row");
    expect(
      within(rows[0])
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Start", "Center", "End"]);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Alex", "120", "alex"]);
    expect(
      within(rows[2])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Start total", "Center total", "End total"]);
  });

  it("hides optional columns and resets them without exposing protected identity columns", () => {
    render(
      <DataTable value={records} showColumnVisibility>
        <Column field="name" header="Name" />
        <Column
          field="amount"
          header="Optional amount"
          hideable
          footer="Total"
        />
      </DataTable>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose optional columns" }),
    );
    expect(
      screen.queryByRole("checkbox", { name: "Name" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Optional amount" }));
    expect(
      screen.queryByRole("columnheader", { name: "Optional amount" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(
      screen.getByRole("columnheader", { name: "Optional amount" }),
    ).toBeVisible();
  });

  it("exposes the real scroll viewport and pins mortgage-style cells and footers", () => {
    const scrollRef = createRef<HTMLDivElement>();
    render(
      <DataTable
        value={records}
        scrollRef={scrollRef}
        scrollable
        scrollHeight="400px"
      >
        <Column
          field="name"
          header="Month"
          frozen
          style={{ width: "120px" }}
          footer="Paid so far"
        />
        <Column field="amount" header="Amount" footer="545" />
      </DataTable>,
    );
    expect(scrollRef.current).toHaveAttribute("data-slot", "table-scroll");
    expect(scrollRef.current).toHaveStyle({ maxHeight: "400px" });
    expect(screen.getByRole("columnheader", { name: "Month" })).toHaveStyle({
      position: "sticky",
      left: "0px",
    });
    expect(screen.getByText("Paid so far")).toHaveStyle({
      position: "sticky",
      left: "0px",
    });
  });
});
