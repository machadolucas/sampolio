"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  createPaginatedRowModel,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type ExpandedState,
} from "@tanstack/react-table";
import { Popover } from "@base-ui/react/popover";
import {
  ChevronDown,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react";

// Cells receive their existing domain records. Column JSX cannot infer a parent
// table's row type; callers can supply Column<DomainType> for typed cell helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableValue = Record<string, any>;
export type DataTableValueArray = DataTableValue[];
export type DataTableExpandedRows = Record<string, boolean>;

export interface ColumnProps<T extends object = DataTableValue> {
  field?: string;
  sortField?: string;
  header?: ReactNode;
  footer?: ReactNode;
  body?: ((row: T) => ReactNode) | ReactNode;
  sortable?: boolean;
  hideable?: boolean;
  visibilityLabel?: string;
  expander?: boolean;
  frozen?: boolean;
  alignFrozen?: "left" | "right";
  align?: "left" | "center" | "right";
  alignHeader?: "left" | "center" | "right";
  style?: CSSProperties;
  headerStyle?: CSSProperties;
  bodyStyle?: CSSProperties;
  footerStyle?: CSSProperties;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}

/** Declarative app column definition; DataTable builds real TanStack columns. */
export function Column<T extends object = DataTableValue>(
  _props: ColumnProps<T>,
) {
  return null;
}

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export interface DataTableProps<T extends object> {
  value?: T[];
  children?: ReactNode;
  dataKey?: string;
  className?: string;
  style?: CSSProperties;
  tableStyle?: CSSProperties;
  scrollable?: boolean;
  scrollHeight?: string;
  /** The actual scroll viewport: consumers use this instead of library CSS. */
  scrollRef?: Ref<HTMLDivElement>;
  size?: "small" | "normal" | "large";
  stripedRows?: boolean;
  rowHover?: boolean;
  loading?: boolean;
  emptyMessage?: ReactNode;
  paginator?: boolean;
  showColumnVisibility?: boolean;
  rows?: number;
  rowsPerPageOptions?: number[];
  sortField?: string;
  sortOrder?: 1 | -1 | 0 | null;
  rowClassName?: (row: T) => string | Record<string, boolean>;
  selectionMode?: "single";
  selection?: T | null;
  onSelectionChange?: (event: {
    value: T;
    originalEvent: React.SyntheticEvent;
  }) => void;
  onRowClick?: (event: {
    data: T;
    originalEvent: React.SyntheticEvent;
  }) => void;
  expandedRows?: DataTableExpandedRows | T[];
  onRowToggle?: (event: { data: DataTableExpandedRows }) => void;
  rowExpansionTemplate?: (row: T) => ReactNode;
  footer?: ReactNode;
  "aria-label"?: string;
}

function readField(row: object, path?: string): unknown {
  if (!path) return undefined;
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row,
    );
}
function columnWidth(style?: CSSProperties): number {
  const width = style?.width ?? style?.minWidth;
  if (typeof width === "number") return width;
  if (typeof width === "string")
    return parseFloat(width) * (width.endsWith("rem") ? 16 : 1) || 150;
  return 150;
}

export function DataTable<T extends object>({
  value = [],
  children,
  dataKey,
  className = "",
  style,
  tableStyle,
  scrollHeight,
  scrollRef,
  size = "normal",
  stripedRows,
  loading,
  emptyMessage = "No records found",
  paginator,
  showColumnVisibility,
  rows = 10,
  rowsPerPageOptions,
  sortField,
  sortOrder,
  rowClassName,
  selectionMode,
  selection,
  onSelectionChange,
  onRowClick,
  expandedRows,
  onRowToggle,
  rowExpansionTemplate,
  footer,
  "aria-label": ariaLabel = "Data table",
}: DataTableProps<T>) {
  const configs = useMemo(
    () =>
      Children.toArray(children)
        .filter(isValidElement)
        .map((child) => (child as React.ReactElement<ColumnProps<T>>).props),
    [children],
  );
  const columnIds = configs.map(
    (config, i) => config.sortField ?? config.field ?? `column-${i}`,
  );
  const columns = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      configs.map((config, i) => ({
        id: config.sortField ?? config.field ?? `column-${i}`,
        accessorFn: (row) => readField(row, config.sortField ?? config.field),
        enableSorting: !!config.sortable,
        sortDescFirst: false,
        enableHiding: !!config.hideable,
        size: columnWidth(config.style),
        sortFn: (a, b, id) => {
          const av = a.getValue(id),
            bv = b.getValue(id);
          if (av == null) return bv == null ? 0 : -1;
          if (bv == null) return 1;
          if (typeof av === "number" && typeof bv === "number") return av - bv;
          if (typeof av === "boolean" && typeof bv === "boolean")
            return Number(av) - Number(bv);
          return String(av).localeCompare(String(bv), "fi-FI", {
            numeric: true,
          });
        },
      })),
    [configs],
  );
  const keyOf = (row: T, index: number) =>
    String(readField(row, dataKey) ?? index);
  const [sorting, setSorting] = useState<SortingState>(
    sortField ? [{ id: sortField, desc: sortOrder === -1 }] : [],
  );
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: rows,
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [localExpanded, setLocalExpanded] = useState<ExpandedState>({});
  const controlledExpanded = Array.isArray(expandedRows)
    ? Object.fromEntries(
        expandedRows.map((row) => [keyOf(row, value.indexOf(row)), true]),
      )
    : expandedRows;
  const columnPinning = {
    start: configs.flatMap((c, i) =>
      c.frozen && c.alignFrozen !== "right" ? [columnIds[i]] : [],
    ),
    end: configs.flatMap((c, i) =>
      c.frozen && c.alignFrozen === "right" ? [columnIds[i]] : [],
    ),
  };
  const table = useTable({
    features,
    data: value,
    columns,
    getRowId: keyOf,
    state: {
      sorting,
      pagination,
      expanded: controlledExpanded ?? localExpanded,
      columnPinning,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onExpandedChange: (updater) => {
      const current = controlledExpanded ?? localExpanded;
      const next = typeof updater === "function" ? updater(current) : updater;
      setLocalExpanded(next);
      onRowToggle?.({
        data:
          next === true
            ? Object.fromEntries(value.map((row, i) => [keyOf(row, i), true]))
            : next,
      });
    },
    getRowCanExpand: () => !!rowExpansionTemplate,
    manualPagination: !paginator,
    // Detail rows are keyed to domain IDs and survive new array identities
    // from slicing, async match metadata and data refreshes.
    autoResetExpanded: false,
  });
  // Keep the configuration lookup independent from a pinned column's position.
  const byId = new Map(columnIds.map((id, index) => [id, configs[index]]));
  const renderedRows = table.getRowModel().rows;
  const visibleColumns = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ];
  const visibleCount = Math.max(1, visibleColumns.length);
  const hasFooters = configs.some((config) => config.footer != null);
  const cellClass = size === "small" ? "px-3 py-2 text-sm" : "px-4 py-3";
  const pinned = (id: string): CSSProperties => {
    const column = table.getColumn(id);
    const side = column?.getIsPinned();
    return !column || !side
      ? {}
      : {
          position: "sticky",
          width: column.getSize(),
          minWidth: column.getSize(),
          maxWidth: column.getSize(),
          ...(side === "start"
            ? { left: column.getStart("start") }
            : { right: column.getAfter("end") }),
          zIndex: 2,
          background: "var(--surface-card, var(--background))",
        };
  };
  const activate = (data: T, event: React.SyntheticEvent) => {
    if (
      (event.target as HTMLElement).closest(
        'button,a,input,select,textarea,[role="button"]',
      )
    )
      return;
    onRowClick?.({ data, originalEvent: event });
    if (selectionMode === "single")
      onSelectionChange?.({ value: data, originalEvent: event });
  };
  const pageCount = Math.max(1, table.getPageCount());
  return (
    <div
      className={`sampolio-data-table min-w-0 ${className}`}
      style={style}
      aria-busy={loading || undefined}
    >
      {showColumnVisibility && configs.some((config) => config.hideable) && (
        <div className="mb-2 flex justify-end">
          <Popover.Root>
            <Popover.Trigger
              className="ui-button"
              aria-label="Choose optional columns"
            >
              Columns
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                align="end"
                sideOffset={6}
                className="ui-popover-positioner"
              >
                <Popover.Popup className="ui-select-popup max-h-80 overflow-auto p-3">
                  <fieldset>
                    <legend className="mb-2 font-semibold">
                      Optional columns
                    </legend>
                    {table
                      .getAllLeafColumns()
                      .filter((column) => column.getCanHide())
                      .map((column) => {
                        const config = byId.get(column.id)!;
                        const label =
                          config.visibilityLabel ??
                          (typeof config.header === "string"
                            ? config.header
                            : (config.field ?? "Column"));
                        return (
                          <label
                            key={column.id}
                            className="flex min-h-11 cursor-pointer items-center gap-3"
                          >
                            <input
                              type="checkbox"
                              checked={column.getIsVisible()}
                              onChange={(event) =>
                                column.toggleVisibility(event.target.checked)
                              }
                              className="size-4 accent-[var(--primary-color)]"
                            />
                            {label}
                          </label>
                        );
                      })}
                    <button
                      type="button"
                      className="ui-button mt-2 w-full"
                      onClick={() => table.resetColumnVisibility()}
                    >
                      Reset columns
                    </button>
                  </fieldset>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      )}
      <div
        ref={scrollRef}
        data-slot="table-scroll"
        className="max-w-full overflow-auto rounded-lg border border-[var(--surface-border)]"
        style={{ maxHeight: scrollHeight }}
      >
        <table
          aria-label={ariaLabel}
          className="w-full border-collapse text-left"
          style={{
            tableLayout: "fixed",
            minWidth: table.getTotalSize(),
            ...tableStyle,
          }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[var(--surface-card)]">
            <tr>
              {visibleColumns.map((column) => {
                const config = byId.get(column.id)!;
                const direction = column.getIsSorted();
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      column.getCanSort()
                        ? direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={`${cellClass} border-b border-[var(--surface-border)] font-semibold ${config.headerClassName ?? ""}`}
                    style={{
                      ...config.style,
                      ...config.headerStyle,
                      textAlign: config.alignHeader ?? config.align,
                      ...pinned(column.id),
                    }}
                  >
                    {column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-2 text-inherit"
                        onClick={column.getToggleSortingHandler()}
                      >
                        {config.header}
                        {direction === "asc" ? (
                          <ArrowUp size={14} aria-hidden />
                        ) : direction === "desc" ? (
                          <ArrowDown size={14} aria-hidden />
                        ) : (
                          <ArrowUpDown size={14} aria-hidden />
                        )}
                      </button>
                    ) : (
                      config.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!loading && renderedRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCount}
                  className="p-6 text-center text-[var(--text-color-secondary)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={visibleCount}
                  className="p-6 text-center"
                  role="status"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              renderedRows.map((row, index) => {
                const rowClass = rowClassName?.(row.original);
                const extraClass =
                  typeof rowClass === "string"
                    ? rowClass
                    : Object.entries(rowClass ?? {})
                        .filter(([, enabled]) => enabled)
                        .map(([name]) => name)
                        .join(" ");
                const selected =
                  selection === row.original ||
                  !!(
                    selection &&
                    dataKey &&
                    readField(selection, dataKey) ===
                      readField(row.original, dataKey)
                  );
                const clickable = !!(onRowClick || selectionMode);
                return (
                  <Fragment key={row.id}>
                    <tr
                      data-row-id={row.id}
                      aria-selected={selectionMode ? selected : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      className={`${extraClass} ${selected ? "bg-[var(--highlight-bg)]" : stripedRows && index % 2 ? "bg-[var(--surface-hover)]" : ""} ${clickable ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--primary-color)]" : ""}`}
                      onClick={(event) => activate(row.original, event)}
                      onKeyDown={(event) => {
                        if (
                          event.target === event.currentTarget &&
                          ["Enter", " "].includes(event.key)
                        ) {
                          event.preventDefault();
                          activate(row.original, event);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const config = byId.get(cell.column.id)!;
                        return (
                          <td
                            key={cell.id}
                            className={`${cellClass} border-b border-[var(--surface-border)] ${config.className ?? ""} ${config.bodyClassName ?? ""}`}
                            style={{
                              ...config.style,
                              ...config.bodyStyle,
                              textAlign: config.align,
                              ...pinned(cell.column.id),
                            }}
                          >
                            {config.expander ? (
                              <button
                                type="button"
                                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
                                aria-label={
                                  row.getIsExpanded()
                                    ? "Collapse row"
                                    : "Expand row"
                                }
                                aria-expanded={row.getIsExpanded()}
                                onClick={row.getToggleExpandedHandler()}
                              >
                                {row.getIsExpanded() ? (
                                  <ChevronDown size={16} />
                                ) : (
                                  <ChevronRight size={16} />
                                )}
                              </button>
                            ) : typeof config.body === "function" ? (
                              config.body(row.original)
                            ) : (
                              (config.body ??
                              String(
                                readField(row.original, config.field) ?? "",
                              ))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {row.getIsExpanded() && rowExpansionTemplate && (
                      <tr>
                        <td colSpan={visibleCount} className="p-4">
                          {rowExpansionTemplate(row.original)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
          {hasFooters && (
            <tfoot className="bg-[var(--surface-card)]">
              <tr>
                {visibleColumns.map((column) => {
                  const config = byId.get(column.id)!;
                  return (
                    <td
                      key={column.id}
                      className={`${cellClass} font-semibold`}
                      style={{
                        ...config.style,
                        ...config.footerStyle,
                        textAlign: config.align,
                        ...pinned(column.id),
                      }}
                    >
                      {config.footer}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {footer != null && <div className="p-3">{footer}</div>}
      {paginator && (
        <div className="material-control-group mt-3 flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
          <label className="inline-flex min-h-11 items-center gap-2">
            Rows per page
            <select
              aria-label="Rows per page"
              className="material-control"
              value={pagination.pageSize}
              onChange={(event) =>
                table.setPageSize(Number(event.target.value))
              }
            >
              {(rowsPerPageOptions ?? [rows]).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <span>
            Page {Math.min(pagination.pageIndex + 1, pageCount)} of {pageCount}
          </span>
          <label className="inline-flex min-h-11 items-center gap-2">
            Go to page
            <select
              aria-label="Go to page"
              className="material-control"
              value={Math.min(pagination.pageIndex, pageCount - 1)}
              onChange={(event) =>
                table.setPageIndex(Number(event.target.value))
              }
            >
              {Array.from({ length: pageCount }, (_, index) => (
                <option key={index} value={index}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="material-control disabled:opacity-40"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.setPageIndex(0)}
            >
              First
            </button>
            <button
              type="button"
              className="material-control disabled:opacity-40"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </button>
            <button
              type="button"
              className="material-control disabled:opacity-40"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </button>
            <button
              type="button"
              className="material-control disabled:opacity-40"
              disabled={!table.getCanNextPage()}
              onClick={() => table.setPageIndex(pageCount - 1)}
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
