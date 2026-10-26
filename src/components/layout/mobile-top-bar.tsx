'use client';

import Link from 'next/link';
import { useTheme } from '@/components/providers/theme-provider';
import { BrandLogo } from '@/components/layout/brand-logo';
import { MdAdd, MdMenu, MdSearch, MdVisibilityOff } from 'react-icons/md';

interface MobileTopBarProps {
  onOpenMenu: () => void;
  onOpenCommandPalette: () => void;
  onOpenSplitQuickAdd?: () => void;
  /** Demo mode on: show the "Demo" pill in the bar (tap turns it off). */
  demoMode?: boolean;
  onExitDemo?: () => void;
}

/**
 * Sticky top app bar for < lg screens. Carries the brand plus the search quick
 * action (→ command palette) and the hamburger that opens the nav drawer.
 * The monthly check-in deliberately lives on Overview, not here. Sits at z-40
 * so shared overlays (z-80+) and dialogs always render above it. Top
 * padding respects the iOS status-bar inset in standalone mode. While demo mode
 * is on, the Demo pill sits in the bar's own flow before Search, so it can never
 * cover the Search button (the desktop pill is a fixed overlay in AppLayout).
 */
export function MobileTopBar({
  onOpenMenu,
  onOpenCommandPalette,
  onOpenSplitQuickAdd,
  demoMode = false,
  onExitDemo,
}: MobileTopBarProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const iconBtn = `flex items-center justify-center w-11 h-11 shrink-0 rounded-lg transition-colors duration-150 active:opacity-60 ${isDark ? 'text-muted-foreground hover:bg-card' : 'text-muted-foreground hover:bg-muted'}`;

  return (
    <header className="lg:hidden fixed top-[calc(0.5rem+env(safe-area-inset-top))] left-2 right-2 z-40 flex items-center justify-between px-2 border rounded-2xl h-14 glass-chrome">
      <div className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className={iconBtn}
        >
          <MdMenu size={24} />
        </button>
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 no-underline ml-1"
        >
          <BrandLogo size={28} className="shrink-0" />
          <span
            className="truncate text-xl font-extrabold text-foreground"
          >
            Sampolio
          </span>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {demoMode && onExitDemo && (
          <button
            type="button"
            onClick={onExitDemo}
            title="Demo mode — amounts hidden. Tap to show them again."
            aria-label="Demo mode active — tap to show amounts"
            className="h-11 px-1 flex items-center cursor-pointer active:opacity-60"
          >
            <span className="rounded-full border surface-border bg-[var(--surface-card)]/80 px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm">
              <MdVisibilityOff size={14} />
              <span>Demo</span>
            </span>
          </button>
        )}
        {onOpenSplitQuickAdd && (
          <button
            type="button"
            onClick={onOpenSplitQuickAdd}
            aria-label="Add shared expense"
            className={iconBtn}
          >
            <MdAdd size={24} />
          </button>
        )}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Search"
          className={iconBtn}
        >
          <MdSearch size={22} />
        </button>
      </div>
    </header>
  );
}
