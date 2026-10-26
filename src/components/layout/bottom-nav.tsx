'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/components/providers/theme-provider';
import {
  navItems,
  isNavItemActive,
  type NavItem,
} from '@/components/layout/nav-config';
import { useAppContext } from '@/components/layout/app-layout';
import { resolveBottomNavIds } from '@/lib/bottom-nav-prefs';
import { MdMoreHoriz } from 'react-icons/md';

interface BottomNavProps {
  onOpenMore: () => void;
}

/**
 * Fixed bottom tab bar for < lg screens. N+1 equal cells — the user's 1-4 chosen
 * tabs plus "More" (opens the nav drawer, always the last cell). The tab list
 * comes from `resolveBottomNavIds` (per-display-mode defaults unless the user
 * picked their own in Settings → General → Mobile navigation); labels/icons are
 * pulled from the shared nav-config by id so they never drift. Each cell is a
 * ≥44px touch target. Sits at z-40 (below overlays).
 *
 * The 4rem capsule floats above the home indicator; main reserves bottom space.
 * Its padded inner track owns both equal-width cells and the active indicator.
 *
 * A small pill under the active cell slides between tabs (`left` animated with
 * `ease-fluid`) and fades out when no primary tab matches the current route
 * (e.g. on a "More" page like /settings or /bank).
 */
export function BottomNav({ onOpenMore }: BottomNavProps) {
  const pathname = usePathname();
  const { theme } = useTheme();
  const appContext = useAppContext();
  const isDark = theme === 'dark';

  const chosenIds = resolveBottomNavIds(
    appContext?.bottomNavIds,
    appContext?.displayMode,
  );
  const primary = chosenIds
    .map((id) => navItems.find((n) => n.id === id))
    .filter((n): n is NavItem => Boolean(n));
  const activeIndex = primary.findIndex((item) =>
    isNavItemActive(pathname, item.href),
  );
  const cells = primary.length + 1; // +1 = the fixed More cell

  const cell =
    'flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full relative z-10 rounded-full min-h-11 text-[0.7rem] font-medium transition-colors duration-150 active:opacity-60';
  const activeCls = 'text-primary font-semibold';
  const idleCls = 'text-muted-foreground';

  return (
    <nav
      data-slot="bottom-nav"
      aria-label="Primary mobile navigation"
      className="lg:hidden fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 flex items-stretch h-16 rounded-full border p-1 glass-chrome"
    >
      <div
        data-slot="bottom-nav-track"
        className="relative flex h-full w-full min-w-0 items-stretch"
      >
        <span
          data-slot="bottom-nav-indicator"
          aria-hidden
          className={`absolute inset-y-0 rounded-full transition-[left,opacity] duration-[250ms] ease-fluid ${isDark ? 'bg-accent-400/20' : 'bg-accent-100'} ${activeIndex >= 0 ? 'opacity-100' : 'opacity-0'}`}
          // Pill centers on the active cell: (index + 0.5) × cell width.
          style={{
            left: `${(activeIndex >= 0 ? activeIndex : 0) * (100 / cells)}%`,
            width: `${100 / cells}%`,
          }}
        />
        {primary.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`${cell} no-underline ${active ? activeCls : idleCls}`}
            >
              {item.icon}
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMore}
          aria-label="More"
          className={`${cell} ${idleCls}`}
        >
          <MdMoreHoriz size={20} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
