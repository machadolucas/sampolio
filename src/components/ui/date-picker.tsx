'use client';

import { Popover } from '@base-ui/react/popover';
import { DayPicker } from '@daypicker/react';
import { fi } from 'date-fns/locale';
import { format, isValid, parse } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { useState, type CSSProperties, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

export interface CalendarProps {
  value?: Date | null;
  onChange?: (event: { value: Date | null }) => void;
  inputId?: string;
  id?: string;
  view?: 'date' | 'month' | 'year';
  showTime?: boolean;
  hourFormat?: string;
  dateFormat?: string;
  placeholder?: string;
  showIcon?: boolean;
  showButtonBar?: boolean;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  readOnlyInput?: boolean;
  className?: string;
  inputClassName?: string;
  style?: CSSProperties;
  inline?: boolean;
  'aria-label'?: string;
  ariaLabel?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}
export function localDateValue(date: Date, withTime = false) {
  return format(date, withTime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
}
export function Calendar({
  value = null,
  onChange,
  inputId,
  id,
  view = 'date',
  showTime,
  dateFormat,
  placeholder,
  showIcon = true,
  showButtonBar,
  minDate,
  maxDate,
  disabled,
  className,
  inputClassName,
  style,
  inline,
  readOnlyInput,
  'aria-label': ariaLabel,
  ariaLabel: legacyLabel,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: CalendarProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const label = ariaLabel ?? legacyLabel;
  const inputType =
    view === 'month' ? 'month' : showTime ? 'datetime-local' : 'date';
  const nativeValue = value
    ? view === 'month'
      ? format(value, 'yyyy-MM')
      : localDateValue(value, showTime)
    : '';
  // Native controls expose a string boundary in local calendar time.
  if (view === 'month') {
    return (
      <MonthPicker
        id={inputId ?? id}
        value={nativeValue || null}
        onValueChange={(month) =>
          onChange?.({ value: month ? new Date(`${month}-01T00:00`) : null })
        }
        min={minDate ? format(minDate, 'yyyy-MM') : undefined}
        max={maxDate ? format(maxDate, 'yyyy-MM') : undefined}
        disabled={disabled}
        readOnly={readOnlyInput}
        className={cn(className, inputClassName)}
        style={style}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }
  if (showTime) {
    return (
      <input
        id={inputId ?? id}
        type={inputType}
        className={cn('ui-input', className, inputClassName)}
        style={style}
        disabled={disabled}
        readOnly={readOnlyInput}
        value={nativeValue}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        min={minDate ? localDateValue(minDate, true) : undefined}
        max={maxDate ? localDateValue(maxDate, true) : undefined}
        onChange={(event) => {
          if (!event.target.value) {
            onChange?.({ value: null });
            return;
          }
          const next = new Date(event.target.value);
          if (
            event.target.validity.valid &&
            isValid(next) &&
            localDateValue(next, true) === event.target.value
          )
            onChange?.({ value: next });
        }}
      />
    );
  }
  const calendar = (
    <DayPicker
      mode="single"
      locale={fi}
      selected={value ?? undefined}
      defaultMonth={value ?? undefined}
      onSelect={(next) => {
        onChange?.({ value: next ?? null });
        setOpen(false);
      }}
      disabled={[
        ...(minDate ? [{ before: minDate }] : []),
        ...(maxDate ? [{ after: maxDate }] : []),
      ]}
      className="ui-calendar"
      classNames={{
        day_button: 'ui-calendar-day',
        selected: 'ui-calendar-selected',
        today: 'ui-calendar-today',
        nav: 'flex justify-between',
        button_previous: 'ui-button',
        button_next: 'ui-button',
        month_caption: 'py-3 font-semibold',
        weekdays: 'text-muted-foreground text-xs',
        month_grid: 'border-collapse',
      }}
    />
  );
  if (inline) return calendar;
  const pattern =
    dateFormat === 'yy-mm-dd'
      ? 'yyyy-MM-dd'
      : dateFormat === 'dd/mm/yy'
        ? 'dd/MM/yyyy'
        : dateFormat === 'dd.mm.yy'
          ? 'dd.MM.yyyy'
          : 'd.M.yyyy';
  const inRange = (date: Date) =>
    (!minDate || date >= minDate) && (!maxDate || date <= maxDate);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn('relative inline-flex min-w-0 items-center', className)}
        style={style}
      >
        <input
          id={inputId ?? id}
          disabled={disabled}
          readOnly={readOnlyInput}
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cn('ui-input pr-24', inputClassName)}
          placeholder={placeholder ?? 'pp.kk.vvvv'}
          value={editing ? text : value ? format(value, pattern) : ''}
          onFocus={() => {
            setText(value ? format(value, pattern) : '');
            setEditing(true);
          }}
          onClick={() => {
            if (!showIcon) setOpen(true);
          }}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            if (!raw) {
              onChange?.({ value: null });
              return;
            }
            const next = parse(raw, pattern, new Date());
            if (isValid(next) && format(next, pattern) === raw && inRange(next))
              onChange?.({ value: next });
          }}
          onBlur={() => setEditing(false)}
        />
        <span className="absolute inset-y-0 right-0 flex">
          {value && !disabled && (
            <button
              type="button"
              className="flex min-w-11 items-center justify-center text-muted-foreground"
              aria-label="Clear date"
              onClick={() => {
                onChange?.({ value: null });
                setText('');
              }}
            >
              <X size={16} />
            </button>
          )}
          {showIcon && (
            <Popover.Trigger
              disabled={disabled}
              className="flex min-w-11 items-center justify-center"
              aria-label="Choose date"
            >
              <CalendarDays size={18} />
            </Popover.Trigger>
          )}
        </span>
      </div>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="ui-popover-positioner">
          <Popover.Popup
            aria-label="Choose date"
            className="ui-select-popup p-3"
          >
            {calendar}
            {showButtonBar && (
              <div className="mt-2 flex justify-between">
                <button
                  type="button"
                  disabled={!inRange(new Date())}
                  className="ui-button"
                  onClick={() => {
                    onChange?.({ value: new Date() });
                    setOpen(false);
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="ui-button"
                  onClick={() => {
                    onChange?.({ value: null });
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Month domain boundary remains YYYY-MM rather than an implicit UTC date. */
export function MonthPicker({
  value,
  onValueChange,
  className,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & { value: string | null; onValueChange: (value: string | null) => void }) {
  return (
    <input
      {...props}
      type="month"
      value={value ?? ''}
      className={cn('ui-input', className)}
      onChange={(event) => {
        const text = event.target.value;
        if (!text) {
          onValueChange(null);
          return;
        }
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text) && event.target.validity.valid)
          onValueChange(text);
      }}
    />
  );
}
