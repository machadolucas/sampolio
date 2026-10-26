'use client';

import { Menu as Primitive } from '@base-ui/react/menu';
import {
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from './cn';

export interface MenuItem {
  label?: string;
  items?: MenuItem[];
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  visible?: boolean;
  className?: string;
  command?: (event: { originalEvent?: unknown; item: MenuItem }) => void;
  template?: (
    item: MenuItem,
    options: {
      className: string;
      labelClassName: string;
      onClick: (event: unknown) => void;
    },
  ) => ReactNode;
}
export interface MenuHandle {
  toggle: (
    event: MouseEvent<HTMLElement> | { currentTarget: EventTarget | null },
  ) => void;
  show: (
    event: MouseEvent<HTMLElement> | { currentTarget: EventTarget | null },
  ) => void;
  hide: () => void;
}
export type Menu = MenuHandle;
export function Menu({
  model = [],
  popup,
  className,
  style,
  ref,
  id,
}: {
  model?: MenuItem[];
  popup?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<MenuHandle>;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      toggle: (event) => {
        anchorRef.current =
          event.currentTarget instanceof HTMLElement
            ? event.currentTarget
            : null;
        setOpen((value) => !value);
      },
      show: (event) => {
        anchorRef.current =
          event.currentTarget instanceof HTMLElement
            ? event.currentTarget
            : null;
        setOpen(true);
      },
      hide: () => setOpen(false),
    }),
    [],
  );
  const visible = model
    .flatMap((item) =>
      item.items
        ? [
            {
              ...item,
              items: undefined,
              disabled: true,
              className: cn(
                'text-xs font-semibold text-muted-foreground',
                item.className,
              ),
            },
            ...item.items,
          ]
        : [item],
    )
    .filter((item) => item.visible !== false);
  const content = (item: MenuItem) =>
    item.template ? (
      item.template(item, {
        className: 'flex min-h-11 w-full items-center text-left',
        labelClassName: '',
        onClick: () => {},
      })
    ) : (
      <span className="flex items-center gap-2">
        {item.icon}
        {item.label}
      </span>
    );
  if (!popup)
    return (
      <div
        id={id}
        className={cn('flex flex-col gap-1', className)}
        style={style}
      >
        {visible.map((item, index) =>
          item.separator ? (
            <hr key={index} className="my-1 border-border" />
          ) : (
            <button
              key={index}
              type="button"
              disabled={item.disabled}
              className={cn('ui-menu-item', item.className)}
              onClick={(event) =>
                item.command?.({ originalEvent: event, item })
              }
            >
              {content(item)}
            </button>
          ),
        )}
      </div>
    );
  return (
    <Primitive.Root open={open} onOpenChange={setOpen}>
      <Primitive.Portal>
        <Primitive.Positioner
          anchor={anchorRef}
          align="end"
          sideOffset={6}
          className="ui-popover-positioner"
        >
          <Primitive.Popup
            id={id}
            finalFocus={anchorRef}
            className={cn('ui-select-popup min-w-52', className)}
            style={style}
          >
            {visible.map((item, index) =>
              item.separator ? (
                <Primitive.Separator
                  key={index}
                  className="my-1 border-t border-border"
                />
              ) : (
                <Primitive.Item
                  key={index}
                  disabled={item.disabled}
                  className={cn('ui-menu-item', item.className)}
                  onClick={(event) =>
                    item.command?.({ originalEvent: event, item })
                  }
                >
                  {content(item)}
                </Primitive.Item>
              ),
            )}
          </Primitive.Popup>
        </Primitive.Positioner>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
