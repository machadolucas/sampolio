'use client';

import { NumberField } from '@base-ui/react/number-field';
import { Minus, Plus } from 'lucide-react';
import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from './cn';

export interface NumberChangeEvent {
  value: number | null;
  originalEvent?: unknown;
}
export interface InputNumberProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'min' | 'max' | 'size' | 'prefix'
> {
  value?: number | null;
  onValueChange?: (event: NumberChangeEvent) => void;
  onValueCommitted?: (event: NumberChangeEvent) => void;
  onChange?: (event: NumberChangeEvent) => void;
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputClassName?: string;
  min?: number;
  max?: number;
  minFractionDigits?: number;
  maxFractionDigits?: number;
  locale?: string;
  mode?: 'decimal' | 'currency';
  currency?: string;
  prefix?: string;
  suffix?: string;
  useGrouping?: boolean;
  showButtons?: boolean;
  size?: number;
}

/** Base UI owns raw intermediate text, locale parsing, clamping and commits. */
export function InputNumber({
  value = null,
  onValueChange,
  onValueCommitted,
  onChange,
  inputId,
  inputRef,
  inputClassName,
  className,
  min,
  max,
  minFractionDigits,
  maxFractionDigits,
  locale = 'fi-FI',
  mode = 'decimal',
  currency = 'EUR',
  prefix,
  suffix,
  useGrouping = true,
  showButtons,
  size,
  step,
  disabled,
  readOnly,
  name,
  required,
  form,
  ...props
}: InputNumberProps) {
  const format: Intl.NumberFormatOptions = {
    style: mode,
    ...(mode === 'currency' ? { currency } : {}),
    minimumFractionDigits: minFractionDigits ?? (mode === 'currency' ? 2 : 0),
    maximumFractionDigits: maxFractionDigits ?? (mode === 'currency' ? 2 : 20),
    useGrouping,
  };
  return (
    <NumberField.Root
      id={inputId ?? props.id}
      value={value}
      min={min}
      max={max}
      locale={locale}
      format={format}
      disabled={disabled}
      readOnly={readOnly}
      name={name}
      required={required}
      form={form}
      step={step === 'any' ? 'any' : step === undefined ? 'any' : Number(step)}
      onValueChange={(next, details) => {
        const event = { value: next, originalEvent: details.event };
        onValueChange?.(event);
        onChange?.(event);
      }}
      onValueCommitted={(next, details) =>
        onValueCommitted?.({ value: next, originalEvent: details.event })
      }
      className={cn('relative inline-flex min-w-0 items-center', className)}
      data-slot="number-field"
    >
      {prefix && (
        <span className="pointer-events-none absolute left-3 text-muted-foreground">
          {prefix}
        </span>
      )}
      <NumberField.Input
        {...props}
        ref={inputRef}
        size={size}
        data-commit-on-submit="number"
        className={cn(
          'ui-input tabular-nums',
          prefix && 'pl-9',
          (suffix || showButtons) && 'pr-12',
          inputClassName,
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 text-muted-foreground">
          {suffix}
        </span>
      )}
      {showButtons && (
        <span className="ml-1 inline-flex">
          <NumberField.Decrement
            className="ui-button"
            aria-label="Decrease value"
          >
            <Minus size={16} />
          </NumberField.Decrement>
          <NumberField.Increment
            className="ui-button"
            aria-label="Increase value"
          >
            <Plus size={16} />
          </NumberField.Increment>
        </span>
      )}
    </NumberField.Root>
  );
}
