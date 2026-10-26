'use client';
import { Button as Primitive } from '@base-ui/react/button';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';
import { Tooltip } from './tooltip';
export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'size'
> {
  label?: string;
  icon?: ReactNode;
  iconPos?: 'left' | 'right' | 'top' | 'bottom';
  loading?: boolean;
  severity?:
    | 'secondary'
    | 'success'
    | 'info'
    | 'warning'
    | 'danger'
    | 'help'
    | 'contrast';
  text?: boolean;
  outlined?: boolean;
  rounded?: boolean;
  raised?: boolean;
  link?: boolean;
  size?: 'small' | 'large' | 'default' | 'sm' | 'lg' | 'icon';
  variant?:
    'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  tooltip?: string;
  tooltipOptions?: { position?: string; showOnDisabled?: boolean };
  ref?: Ref<HTMLButtonElement>;
}
export function Button({
  label,
  icon,
  iconPos = 'left',
  loading,
  severity,
  text,
  outlined,
  rounded,
  raised,
  link,
  size,
  variant,
  tooltip,
  tooltipOptions,
  className,
  children,
  type = 'button',
  disabled,
  ref,
  ...props
}: ButtonProps) {
  const style =
    variant ??
    (link
      ? 'link'
      : text
        ? 'ghost'
        : outlined
          ? 'outline'
          : severity === 'danger'
            ? 'destructive'
            : severity === 'secondary'
              ? 'secondary'
              : 'default');
  const button = (
    <Primitive
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-slot="button"
      data-variant={style}
      data-size={size}
      data-tone={severity}
      className={cn(
        'ui-button',
        rounded && 'rounded-full',
        size === 'icon' && 'aspect-square',
        raised && 'shadow-md',
        className,
      )}
      {...props}
    >
      {(loading || icon) && (
        <span
          aria-hidden="true"
          className={cn(
            'shrink-0 [&>svg]:size-4',
            iconPos === 'right' && 'order-last',
          )}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : icon}
        </span>
      )}
      {(label || children) && (
        <span
          data-slot="button-label"
          className="inline-flex min-w-0 items-center justify-center gap-2"
        >
          {label ?? children}
        </span>
      )}
    </Primitive>
  );
  const position = tooltipOptions?.position;
  return tooltip ? (
    <Tooltip
      content={tooltip}
      event="hover"
      position={
        position === 'left' || position === 'right' || position === 'bottom'
          ? position
          : 'top'
      }
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
}
