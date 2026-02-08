'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useRef } from 'react';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { Tooltip } from 'primereact/tooltip';
import { useTheme } from '@/components/providers/theme-provider';
import { MenuItem } from 'primereact/menuitem';
import type { NavigationPage } from '@/types';
import { MdHome, MdAttachMoney, MdSettings, MdLightMode, MdDarkMode, MdLogout, MdSync, MdSearch, MdPerson, MdChevronRight, MdChevronLeft } from 'react-icons/md';

interface SidebarNavProps {
    onOpenReconcile: () => void;
    onOpenCommandPalette: () => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

interface NavItem {
    id: NavigationPage;
    label: string;
    icon: ReactNode;
    href: string;
}

const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <MdHome size={20} />, href: '/' },
    { id: 'cashflow', label: 'Cashflow', icon: <MdAttachMoney size={20} />, href: '/cashflow' },
    { id: 'settings', label: 'Settings', icon: <MdSettings size={20} />, href: '/settings' },
];

export function SidebarNav({
    onOpenReconcile,
    onOpenCommandPalette,
    collapsed = false,
    onToggleCollapse,
}: SidebarNavProps) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const { theme, toggleTheme } = useTheme();
    const userMenuRef = useRef<Menu>(null);

    const isDark = theme === 'dark';

    const isActive = (href: string) => {
        if (href === '/') {
            return pathname === '/' || pathname === '/dashboard';
        }
        return pathname.startsWith(href);
    };

    const userMenuItems: MenuItem[] = [
        {
            label: session?.user?.name || 'User',
            disabled: true,
            className: 'font-semibold',
        },
        {
            label: session?.user?.email || '',
            disabled: true,
            className: 'text-sm opacity-70',
        },
        { separator: true },
        {
            label: isDark ? 'Light Mode' : 'Dark Mode',
            icon: isDark ? <MdLightMode /> : <MdDarkMode />,
            command: toggleTheme,
        },
        { separator: true },
        {
            label: 'Sign Out',
            icon: <MdLogout />,
            command: () => signOut({ callbackUrl: '/auth/signin' }),
        },
    ];

    const expanded = !collapsed;

    return (
        <aside
            className={`fixed left-0 top-0 h-screen z-50 flex flex-col transition-all duration-300 border-r ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
                } ${expanded ? 'w-64' : 'w-16'}`}
        >
            {/* Logo */}
            <div className={`flex items-center h-16 px-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <Link href="/" className="flex items-center gap-3 no-underline">
                    <span className="text-2xl">💰</span>
                    {expanded && (
                        <span className={`text-xl font-bold whitespace-nowrap ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            Sampolio
                        </span>
                    )}
                </Link>
            </div>

            {/* Quick Actions */}
            <div className={`flex ${expanded ? 'flex-row gap-2 px-4' : 'flex-col gap-2 px-2'} py-4`}>
                <Button
                    icon={<MdSync />}
                    label={expanded ? 'Reconcile' : undefined}
                    severity="success"
                    size="small"
                    className={expanded ? 'flex-1' : 'w-full justify-center'}
                    onClick={onOpenReconcile}
                    tooltip={!expanded ? 'Reconcile' : undefined}
                    tooltipOptions={{ position: 'right' }}
                />
                <Button
                    icon={<MdSearch />}
                    severity="secondary"
                    size="small"
                    text
                    className={expanded ? '' : 'w-full justify-center'}
                    onClick={onOpenCommandPalette}
                    tooltip={!expanded ? '⌘K' : undefined}
                    tooltipOptions={{ position: 'right' }}
                />
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4">
                <ul className="space-y-1">
                    {navItems.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <li key={item.id}>
                                <Link
                                    href={item.href}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors no-underline ${active
                                        ? isDark
                                            ? 'bg-blue-900/50 text-blue-400'
                                            : 'bg-blue-50 text-blue-700'
                                        : isDark
                                            ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                        }`}
                                    data-pr-tooltip={!expanded ? item.label : undefined}
                                    data-pr-position="right"
                                >
                                    {item.icon}
                                    {expanded && (
                                        <span className="font-medium whitespace-nowrap">{item.label}</span>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* User Section */}
            <div className={`mt-auto border-t ${isDark ? 'border-gray-700' : 'border-gray-200'} p-3`}>
                <Menu model={userMenuItems} popup ref={userMenuRef} />
                <Button
                    className={`w-full ${expanded ? 'justify-start' : 'justify-center'}`}
                    text
                    severity="secondary"
                    onClick={(e) => userMenuRef.current?.toggle(e)}
                >
                    <MdPerson size={18} />
                    {expanded && (
                        <span className="ml-3 truncate">{session?.user?.name || 'User'}</span>
                    )}
                </Button>
            </div>

            {/* Collapse Toggle */}
            {onToggleCollapse && (
                <div className="absolute top-1/2 -right-3 transform -translate-y-1/2">
                    <Button
                        icon={collapsed ? <MdChevronRight /> : <MdChevronLeft />}
                        rounded
                        size="small"
                        severity="secondary"
                        className="shadow-md"
                        onClick={onToggleCollapse}
                    />
                </div>
            )}

            <Tooltip target="[data-pr-tooltip]" />
        </aside>
    );
}
