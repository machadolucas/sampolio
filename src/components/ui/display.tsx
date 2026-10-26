'use client';

import { Progress } from '@base-ui/react/progress';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown, LoaderCircle, X } from 'lucide-react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
export type Severity =
  'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | 'help';
export function Card({
  title,
  subTitle,
  footer,
  header,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode;
  subTitle?: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
}) {
  return (
    <section data-slot="card" className={cn('ui-card', className)} {...props}>
      {header}
      {(title || subTitle) && (
        <header className="mb-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {subTitle && (
            <p className="text-sm text-muted-foreground">{subTitle}</p>
          )}
        </header>
      )}
      {children}
      {footer && <footer className="mt-4">{footer}</footer>}
    </section>
  );
}
export function Tag({
  value,
  children,
  severity = 'secondary',
  rounded,
  icon,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  value?: ReactNode;
  severity?: Severity;
  rounded?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span
      data-slot="badge"
      data-tone={severity}
      className={cn('ui-badge', rounded && 'rounded-full', className)}
      {...props}
    >
      {icon}
      {value ?? children}
    </span>
  );
}
export const Badge = Tag;
export function Chip({
  label,
  removable,
  onRemove,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  label?: ReactNode;
  removable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span className={cn('ui-badge', className)} {...props}>
      {label}
      {removable && (
        <button
          type="button"
          className="min-h-11 min-w-11"
          aria-label={`Remove ${String(label)}`}
          onClick={onRemove}
        >
          <X size={14} />
        </button>
      )}
    </span>
  );
}
export function Message({
  text,
  children,
  severity = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  text?: ReactNode;
  severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast';
}) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      className={cn('ui-alert', className)}
      data-tone={severity}
      {...props}
    >
      {text ?? children}
    </div>
  );
}
export function Divider({
  className,
}: {
  className?: string;
  align?: string;
  type?: string;
}) {
  return <hr className={cn('my-4 border-border', className)} />;
}
export function Skeleton({
  width,
  height,
  shape,
  borderRadius,
  className,
  style,
}: {
  width?: string;
  height?: string;
  shape?: string;
  borderRadius?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-muted',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={{ width, height: height ?? '1rem', borderRadius, ...style }}
    />
  );
}
export function ProgressSpinner({
  className,
  style,
  'aria-label': label = 'Loading',
}: {
  className?: string;
  style?: CSSProperties;
  strokeWidth?: string;
  animationDuration?: string;
  'aria-label'?: string;
}) {
  return (
    <LoaderCircle
      role="status"
      aria-label={label}
      className={cn('size-8 animate-spin text-primary', className)}
      style={style}
    />
  );
}
export function ProgressBar({
  value = 0,
  showValue = true,
  className,
  style,
  color,
}: {
  value?: number | null;
  showValue?: boolean;
  className?: string;
  style?: CSSProperties;
  color?: string;
}) {
  return (
    <Progress.Root
      value={value}
      className={cn(
        'relative h-2 overflow-hidden rounded-full bg-muted',
        className,
      )}
      style={style}
      aria-label="Progress"
    >
      <Progress.Track className="h-full">
        <Progress.Indicator
          className="h-full rounded-full bg-primary"
          style={color ? { backgroundColor: color } : undefined}
        />
      </Progress.Track>
      {showValue && <Progress.Value className="sr-only" />}
    </Progress.Root>
  );
}
export function Panel({
  header,
  children,
  toggleable,
  collapsed,
  onToggle,
  className,
}: {
  header?: ReactNode;
  children?: ReactNode;
  toggleable?: boolean;
  collapsed?: boolean;
  onToggle?: (event: { value: boolean }) => void;
  className?: string;
}) {
  return (
    <Collapsible.Root
      open={collapsed === undefined ? undefined : !collapsed}
      defaultOpen
      onOpenChange={(open) => onToggle?.({ value: !open })}
      className={cn('ui-card', className)}
    >
      {toggleable ? (
        <Collapsible.Trigger className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold">
          {header}
          <ChevronDown size={18} />
        </Collapsible.Trigger>
      ) : (
        header && <h3 className="mb-3 font-semibold">{header}</h3>
      )}
      <Collapsible.Panel className="min-w-0">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
export function IconField({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
  iconPosition?: string;
}) {
  return (
    <div className={cn('relative [&_input]:pl-10', className)}>{children}</div>
  );
}
export function InputIcon({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 left-3 flex items-center',
        className,
      )}
    >
      {children}
    </span>
  );
}
