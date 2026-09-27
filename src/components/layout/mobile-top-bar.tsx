'use client';

import Link from 'next/link';
import { useTheme } from '@/components/providers/theme-provider';
import { BrandLogo } from '@/components/layout/brand-logo';
import { MdMenu, MdSearch, MdVisibilityOff } from 'react-icons/md';

interface MobileTopBarProps {
    onOpenMenu: () => void;
    onOpenCommandPalette: () => void;
    /** Demo mode on: show the "Demo" pill in the bar (tap turns it off). */
    demoMode?: boolean;
    onExitDemo?: () => void;
}

/**
 * Sticky top app bar for < lg screens. Carries the brand plus the search quick
 * action (→ command palette) and the hamburger that opens the nav drawer.
 * The monthly check-in deliberately lives on Overview, not here. Sits at z-40
 * so PrimeReact overlays (z-50+) and dialogs always render above it. Top
 * padding respects the iOS status-bar inset in standalone mode. While demo mode
 * is on, the Demo pill sits in the bar's own flow before Search, so it can never
 * cover the Search button (the desktop pill is a fixed overlay in AppLayout).
 */
export function MobileTopBar({ onOpenMenu, onOpenCommandPalette, demoMode = false, onExitDemo }: MobileTopBarProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const iconBtn = `flex items-center justify-center w-11 h-11 rounded-lg transition-colors duration-150 active:opacity-60 ${isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`;

    return (
        <header
            className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-2 border-b pt-[env(safe-area-inset-top)] h-[calc(3.5rem+env(safe-area-inset-top))] glass-chrome"
        >
            <div className="flex items-center">
                <button type="button" onClick={onOpenMenu} aria-label="Open menu" className={iconBtn}>
                    <MdMenu size={24} />
                </button>
                <Link href="/" className="flex items-center gap-2 no-underline ml-1">
                    <BrandLogo size={28} className="shrink-0" />
                    <span className={`text-xl font-extrabold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>Sampolio</span>
                </Link>
            </div>
            <div className="flex items-center gap-1">
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
                <button type="button" onClick={onOpenCommandPalette} aria-label="Search" className={iconBtn}>
                    <MdSearch size={22} />
                </button>
            </div>
        </header>
    );
}
