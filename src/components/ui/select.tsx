'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

type Option<T, S> = {
  key: number;
  value: T | null;
  label: string;
  source: S;
  disabled: boolean;
  group?: string;
};
interface CommonProps<S> {
  options?: readonly S[];
  optionLabel?: string;
  optionValue?: string;
  optionDisabled?: string;
  optionGroupLabel?: string;
  optionGroupChildren?: string;
  inputId?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  filter?: boolean;
  filterPlaceholder?: string;
  showClear?: boolean;
  className?: string;
  style?: CSSProperties;
  panelClassName?: string;
  itemTemplate?: (option: S) => ReactNode;
  valueTemplate?: (
    option: S | undefined,
    props: { placeholder?: string },
  ) => ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  onBlur?: () => void;
  emptyMessage?: string;
  tooltip?: string;
  tooltipOptions?: { position?: string };
}
export interface DropdownProps<T = string, S = unknown> extends CommonProps<S> {
  value?: T | null;
  onChange?: (event: { value: T | null }) => void;
}
function normalize<T, S>(props: CommonProps<S>): Option<T, S>[] {
  const sources = (props.options ?? []).flatMap<{ source: S; group?: string }>(
    (source) => {
      const row =
        typeof source === 'object' && source !== null
          ? (source as Record<string, unknown>)
          : null;
      const children =
        row && props.optionGroupChildren
          ? row[props.optionGroupChildren]
          : null;
      return Array.isArray(children)
        ? children.map((child) => ({
            source: child as S,
            group: String(row?.[props.optionGroupLabel ?? 'label'] ?? ''),
          }))
        : [{ source, group: undefined }];
    },
  );
  return sources.map(({ source, group }, key) => {
    if (typeof source !== 'object' || source === null) {
      return {
        key,
        source,
        group,
        value: source as unknown as T,
        label: String(source),
        disabled: false,
      };
    }
    const row = source as Record<string, unknown>;
    const valueKey =
      props.optionValue ?? ('value' in row ? 'value' : undefined);
    return {
      key,
      source,
      group,
      value: (valueKey ? row[valueKey] : source) as T | null,
      label: String(row[props.optionLabel ?? 'label'] ?? row.name ?? ''),
      disabled: Boolean(row[props.optionDisabled ?? 'disabled']),
    };
  });
}
interface OptionGroup<T, S> {
  label: string;
  items: Option<T, S>[];
}
function groupedItems<T, S>(options: Option<T, S>[]) {
  const groups = new Map<string, Option<T, S>[]>();
  for (const option of options) {
    const name = option.group ?? '';
    const items = groups.get(name) ?? [];
    items.push(option);
    groups.set(name, items);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}
function Popup<T, S>({ props }: { props: CommonProps<S> }) {
  const renderOption = (option: Option<T, S>) => (
    <Combobox.Item
      key={option.key}
      value={option}
      disabled={option.disabled}
      className="ui-select-item"
    >
      <span className="min-w-0 flex-1">
        {props.itemTemplate ? props.itemTemplate(option.source) : option.label}
      </span>
      <Combobox.ItemIndicator>
        <Check size={16} />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );
  return (
    <Combobox.Portal>
      <Combobox.Positioner sideOffset={6} className="ui-popover-positioner">
        <Combobox.Popup className={cn('ui-select-popup', props.panelClassName)}>
          {props.filter && (
            <Combobox.Input
              className="ui-input mb-1"
              placeholder={props.filterPlaceholder ?? 'Search…'}
              aria-label={props.filterPlaceholder ?? 'Search options'}
            />
          )}
          <Combobox.Empty className="p-3 text-sm text-muted-foreground">
            {props.emptyMessage ?? 'No matching options'}
          </Combobox.Empty>
          <Combobox.List>
            {(entry: Option<T, S> | OptionGroup<T, S>) =>
              'items' in entry ? (
                <Combobox.Group key={entry.label} items={entry.items}>
                  <Combobox.GroupLabel className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
                    {entry.label}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>{renderOption}</Combobox.Collection>
                </Combobox.Group>
              ) : (
                renderOption(entry)
              )
            }
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}
export function Dropdown<T = string, S = unknown>(props: DropdownProps<T, S>) {
  const options = normalize<T, S>(props);
  const selected =
    options.find((o) => Object.is(o.value, props.value ?? null)) ?? null;
  return (
    <Combobox.Root<Option<T, S>>
      items={props.optionGroupChildren ? groupedItems(options) : options}
      value={selected}
      onValueChange={(option) =>
        props.onChange?.({ value: option?.value ?? null })
      }
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => Object.is(a.value, b.value)}
      disabled={props.disabled}
      name={props.name}
    >
      <div
        className={cn('relative inline-flex min-w-0', props.className)}
        style={props.style}
      >
        <Combobox.Trigger
          id={props.inputId ?? props.id}
          onBlur={props.onBlur}
          aria-label={props['aria-label']}
          aria-describedby={props['aria-describedby']}
          aria-invalid={props['aria-invalid']}
          aria-labelledby={props['aria-labelledby']}
          title={props.tooltip}
          className="ui-input flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate">
            {props.valueTemplate
              ? props.valueTemplate(selected?.source, {
                  placeholder: props.placeholder,
                })
              : (selected?.label ?? (
                  <span className="text-muted-foreground">
                    {props.placeholder ?? 'Select…'}
                  </span>
                ))}
          </span>
          <ChevronDown size={16} />
        </Combobox.Trigger>
        {props.showClear && selected && !props.disabled && (
          <Combobox.Clear aria-label="Clear selection" className="ui-clear">
            <X size={14} />
          </Combobox.Clear>
        )}
      </div>
      <Popup props={props} />
    </Combobox.Root>
  );
}
export interface MultiSelectProps<
  T = string,
  S = unknown,
> extends CommonProps<S> {
  value?: T[] | null;
  onChange?: (event: { value: T[] }) => void;
  display?: string;
  maxSelectedLabels?: number;
  selectedItemsLabel?: string;
}
export function MultiSelect<T = string, S = unknown>(
  props: MultiSelectProps<T, S>,
) {
  const options = normalize<T, S>(props);
  const selected = options.filter((o) =>
    (props.value ?? []).some((v) => Object.is(v, o.value)),
  );
  return (
    <Combobox.Root<Option<T, S>, true>
      multiple
      items={props.optionGroupChildren ? groupedItems(options) : options}
      value={selected}
      onValueChange={(rows) =>
        props.onChange?.({ value: rows.map((o) => o.value as T) })
      }
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => Object.is(a.value, b.value)}
      disabled={props.disabled}
      name={props.name}
    >
      <div
        className={cn('relative inline-flex min-w-0', props.className)}
        style={props.style}
      >
        <Combobox.Trigger
          id={props.inputId ?? props.id}
          onBlur={props.onBlur}
          aria-label={props['aria-label']}
          aria-describedby={props['aria-describedby']}
          aria-invalid={props['aria-invalid']}
          aria-description={
            selected.map((option) => option.label).join(', ') ||
            'No selected options'
          }
          title={props.tooltip}
          className="ui-input flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate">
            {selected.length ? (
              props.display === 'chip' ? (
                <span className="flex flex-wrap gap-1">
                  {selected.map((option) => (
                    <span key={option.key} className="ui-badge">
                      {option.label}
                    </span>
                  ))}
                </span>
              ) : (
                selected.map((o) => o.label).join(', ')
              )
            ) : (
              (props.placeholder ?? 'Select…')
            )}
          </span>
          <ChevronDown size={16} />
        </Combobox.Trigger>
      </div>
      <Popup props={props} />
    </Combobox.Root>
  );
}
