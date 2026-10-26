'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Switch } from '@base-ui/react/switch';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';
export function Checkbox({
  checked,
  onChange,
  inputId,
  id,
  disabled,
  className,
  value,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  checked?: boolean;
  onChange?: (event: { checked: boolean; value?: unknown }) => void;
  inputId?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  value?: unknown;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center',
        className,
      )}
    >
      <CheckboxPrimitive.Root
        nativeButton
        render={<button type="button" />}
        id={inputId ?? id}
        checked={checked ?? false}
        disabled={disabled}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onCheckedChange={(next) => onChange?.({ checked: next, value })}
        className="ui-checkbox"
      >
        <CheckboxPrimitive.Indicator>
          <Check size={14} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    </span>
  );
}
export function InputSwitch({
  checked,
  onChange,
  inputId,
  disabled,
  className,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  checked?: boolean;
  onChange?: (event: { value: boolean }) => void;
  inputId?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <Switch.Root
      nativeButton
      render={<button type="button" />}
      id={inputId}
      checked={checked ?? false}
      disabled={disabled}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      onCheckedChange={(value) => onChange?.({ value })}
      className={cn('ui-switch', className)}
    >
      <Switch.Thumb className="ui-switch-thumb" />
    </Switch.Root>
  );
}
export function SelectButton<T = string>({
  value,
  options,
  onChange,
  optionLabel = 'label',
  optionValue = 'value',
  allowEmpty = true,
  disabled,
  className,
  itemTemplate,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value?: T | null;
  options: readonly unknown[];
  onChange?: (event: { value: T | null }) => void;
  optionLabel?: string;
  optionValue?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  itemTemplate?: (option: T) => ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const rows = options.map((option, index) => {
    const row =
      typeof option === 'object' && option !== null
        ? (option as Record<string, unknown>)
        : null;
    return {
      key: String(index),
      value: (row ? row[optionValue] : option) as T,
      label: String(row ? row[optionLabel] : option),
      source: option,
    };
  });
  const selected = rows.find((row) => Object.is(row.value, value));
  return (
    <ToggleGroup
      value={selected ? [selected.key] : []}
      disabled={disabled}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className={cn('ui-segmented', className)}
      onValueChange={(keys) => {
        const row = rows.find((item) => item.key === keys[0]);
        if (row || allowEmpty) onChange?.({ value: row?.value ?? null });
      }}
    >
      {rows.map((row) => (
        <Toggle
          key={row.key}
          value={row.key}
          className="ui-segment"
          aria-label={row.label}
        >
          {itemTemplate ? itemTemplate(row.source as T) : row.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
export function Slider({
  value = 0,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  style,
  disabled,
  'aria-label': label = 'Value',
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value?: number;
  onChange?: (event: { value: number }) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) =>
        onChange?.({ value: Array.isArray(next) ? next[0] : next })
      }
      className={cn('w-full', className)}
      style={style}
    >
      <SliderPrimitive.Control className="relative flex h-11 w-full items-center">
        <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className="size-6 rounded-full border-2 border-card bg-primary shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
