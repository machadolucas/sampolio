'use client';

import { Tabs } from '@base-ui/react/tabs';
import { Children, isValidElement, useState, type ReactNode } from 'react';
import { cn } from './cn';
export interface TabPanelProps {
  header: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  leftIcon?: ReactNode;
}
export function TabPanel({ children }: TabPanelProps) {
  return <>{children}</>;
}
export function TabView({
  children,
  activeIndex,
  onTabChange,
  className,
  scrollable,
}: {
  children?: ReactNode;
  activeIndex?: number;
  onTabChange?: (event: { index: number }) => void;
  className?: string;
  scrollable?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const panels = Children.toArray(children).filter(
    isValidElement<TabPanelProps>,
  );
  return (
    <Tabs.Root
      value={activeIndex ?? index}
      onValueChange={(value) => {
        const next = Number(value);
        setIndex(next);
        onTabChange?.({ index: next });
      }}
      className={cn('min-w-0', className)}
    >
      <Tabs.List
        className={cn(
          'mb-5 flex max-w-full gap-1 border-b border-border',
          scrollable ? 'overflow-x-auto' : 'flex-wrap',
        )}
      >
        {panels.map((panel, i) => (
          <Tabs.Tab
            key={panel.key ?? i}
            value={i}
            disabled={panel.props.disabled}
            className="ui-tab"
          >
            {panel.props.leftIcon}
            {panel.props.header}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {panels.map((panel, i) => (
        <Tabs.Panel key={panel.key ?? i} value={i} keepMounted={false}>
          {panel.props.children}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
export { Tabs };
