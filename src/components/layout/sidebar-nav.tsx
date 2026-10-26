'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import {
  isNavItemActive,
  useUserMenuItems,
  useVisibleNavItems,
} from './nav-config';
import { BrandLogo } from './brand-logo';
import { UserAvatar } from '@/components/ui/user-avatar';
import { getInitials } from '@/lib/avatar-utils';
import { useUserProfiles } from '@/lib/hooks/use-user-profiles';

interface SidebarNavProps {
  onOpenCommandPalette: () => void;
  onOpenSplitQuickAdd?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}
export function SidebarNav({
  onOpenCommandPalette,
  onOpenSplitQuickAdd,
  collapsed = false,
  onToggleCollapse,
}: SidebarNavProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const menu = useRef<Menu>(null);
  const items = useVisibleNavItems();
  const userItems = useUserMenuItems();
  const id = session?.user?.id;
  const name = session?.user?.name || 'User';
  const profiles = useUserProfiles(id ? [id] : []);
  const expanded = !collapsed;
  return (
    <aside
      aria-label="Main navigation"
      className={`hidden lg:flex fixed left-2 top-[calc(0.5rem+env(safe-area-inset-top))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 flex-col rounded-3xl border glass-chrome transition-[width] duration-(--motion-slow) ${expanded ? 'w-64' : 'w-18'}`}
    >
      <div
        className={`flex h-18 shrink-0 items-center ${expanded ? 'px-4' : 'justify-center px-0'}`}
      >
        <Link
          href="/"
          aria-label="Sampolio home"
          className={`flex min-h-11 items-center no-underline ${expanded ? 'gap-3' : 'min-w-11 justify-center'}`}
        >
          <BrandLogo size={30} />
          {expanded && (
            <span className="text-xl font-bold tracking-tight">Sampolio</span>
          )}
        </Link>
      </div>
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-3">
        <Tooltip content="Search (⌘K)" position="right">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label={expanded ? 'Search ⌘K' : 'Search'}
            aria-keyshortcuts="Meta+K Control+K"
            className={`flex min-h-11 w-full items-center rounded-xl text-muted-foreground hover:bg-accent ${expanded ? 'gap-3 px-3' : 'justify-center px-0'}`}
          >
            <Search size={20} />
            {expanded && (
              <>
                <span className="flex-1 text-left text-sm">Search</span>
                <kbd aria-hidden="true" className="text-xs">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </Tooltip>
        {onOpenSplitQuickAdd && (
          <Tooltip content="Add shared expense" position="right">
            <Button
              variant="outline"
              icon={<Plus />}
              label={expanded ? 'Add shared expense' : undefined}
              aria-label="Add shared expense"
              onClick={onOpenSplitQuickAdd}
              className={`w-full ${expanded ? 'justify-start' : 'justify-center px-0'}`}
            />
          </Tooltip>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <li key={item.id}>
                <Tooltip content={item.label} position="right">
                  <Link
                    href={item.href}
                    aria-label={expanded ? undefined : item.label}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-11 items-center rounded-xl py-2.5 no-underline ${expanded ? 'gap-3 px-3' : 'justify-center px-0'} transition-colors duration-(--motion-fast) ${active ? 'bg-accent font-semibold text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                  >
                    {item.icon}
                    {expanded && <span className="text-sm">{item.label}</span>}
                  </Link>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="m-2 mt-4 border-t border-border pt-2">
        {onToggleCollapse && (
          <Button
            variant="ghost"
            className={`w-full ${expanded ? 'justify-start' : 'justify-center px-0'}`}
            icon={collapsed ? <ChevronRight /> : <ChevronLeft />}
            label={expanded ? 'Collapse' : undefined}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={onToggleCollapse}
          />
        )}
        <Menu ref={menu} model={userItems} popup />
        <Button
          variant="ghost"
          className={`w-full ${expanded ? 'justify-start' : 'justify-center px-0'}`}
          aria-label={`${getInitials(name)} ${name} account menu`}
          aria-haspopup="menu"
          onClick={(event) => menu.current?.toggle(event)}
        >
          <span aria-hidden="true">
            <UserAvatar
              userId={id ?? ''}
              name={name}
              avatarUrl={id ? profiles[id]?.avatarUrl : undefined}
              size={28}
            />
          </span>{' '}
          {expanded && (
            <span className="min-w-0 truncate text-left">{name}</span>
          )}
        </Button>
      </div>
    </aside>
  );
}
