'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/ui/sheet';
import { Menu } from '@/components/ui/menu';
import { useTheme } from '@/components/providers/theme-provider';
import { isNavItemActive, useUserMenuItems, useVisibleNavItems } from '@/components/layout/nav-config';
import { BrandLogo } from '@/components/layout/brand-logo';

interface MobileNavDrawerProps {
    visible: boolean;
    onHide: () => void;
}

/**
 * Off-canvas navigation for < lg screens. Uses the shared Sheet pattern
 * already proven in entity-list-drawer (children + header prop + the built-in
 * close button) and the shared nav-config so it never drifts from the desktop
 * sidebar. Opened by both the top-bar hamburger and the bottom-nav "More" tab.
 */
export function MobileNavDrawer({ visible, onHide }: MobileNavDrawerProps) {
    const pathname = usePathname();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const userMenuItems = useUserMenuItems(onHide);
    const visibleNavItems = useVisibleNavItems();

    const header = (
        <Link href="/" onClick={onHide} className="flex items-center gap-2 no-underline">
            <BrandLogo size={30} className="shrink-0" />
            <span className="text-2xl font-extrabold text-foreground">Sampolio</span>
        </Link>
    );

    return (
        <Sidebar
            visible={visible}
            onHide={onHide}
            position="left"
            header={header}
            className="w-[80vw] max-w-[20rem]"
            modal
            dismissable
        >
            <nav className="-mt-2">
                <ul className="space-y-1">
                    {visibleNavItems.map((item) => {
                        const active = isNavItemActive(pathname, item.href);
                        return (
                            <li key={item.id}>
                                <Link
                                    href={item.href}
                                    onClick={onHide}
                                    aria-current={active ? 'page' : undefined}
                                    className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors duration-150 no-underline ${active
                                        ? isDark ? 'bg-accent-400/20 text-accent-300 active:bg-accent-400/30' : 'bg-accent-100 text-accent-800 active:bg-accent-200'
                                        : isDark ? 'text-muted-foreground hover:bg-card hover:text-foreground active:bg-card' : 'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted'
                                        }`}
                                >
                                    {item.icon}
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Account / preferences */}
            <div className="mt-4 pt-2 border-t border-border">
                <Menu model={userMenuItems} className="w-full border-none" />
            </div>
        </Sidebar>
    );
}
