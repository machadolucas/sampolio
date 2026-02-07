'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useRef } from 'react';
import { Button } from 'primereact/button';
import { Menubar } from 'primereact/menubar';
import { Menu } from 'primereact/menu';
import { useTheme } from '@/components/providers/theme-provider';
import { MenuItem } from 'primereact/menuitem';

interface TopBarProps {
    onOpenAccounts?: () => void;
    onOpenRecurring?: () => void;
    onOpenPlanned?: () => void;
    onOpenSalary?: () => void;
    onOpenInvestments?: () => void;
    onOpenDebts?: () => void;
    onOpenReceivables?: () => void;
    onOpenUsers?: () => void;
    onOpenSettings?: () => void;
    hasActiveAccounts?: boolean;
}

export function TopBar({
    onOpenAccounts,
    onOpenRecurring,
    onOpenPlanned,
    onOpenSalary,
    onOpenInvestments,
    onOpenDebts,
    onOpenReceivables,
    onOpenUsers,
    onOpenSettings,
    hasActiveAccounts,
}: TopBarProps) {
    const { data: session } = useSession();
    const { theme, toggleTheme } = useTheme();
    const userMenuRef = useRef<Menu>(null);

    const isAdmin = session?.user?.role === 'admin';
    const isDark = theme === 'dark';

    const menuItems: MenuItem[] = [
        {
            label: 'Accounts',
            icon: 'pi pi-wallet',
            command: onOpenAccounts,
        },
        {
            label: 'Recurring',
            icon: 'pi pi-sync',
            command: onOpenRecurring,
            disabled: !hasActiveAccounts,
        },
        {
            label: 'Planned',
            icon: 'pi pi-calendar',
            command: onOpenPlanned,
            disabled: !hasActiveAccounts,
        },
        {
            label: 'Salary',
            icon: 'pi pi-calculator',
            command: onOpenSalary,
            disabled: !hasActiveAccounts,
        },
        {
            separator: true,
        },
        {
            label: 'Wealth',
            icon: 'pi pi-chart-line',
            items: [
                {
                    label: 'Dashboard',
                    icon: 'pi pi-th-large',
                    url: '/wealth',
                },
                {
                    separator: true,
                },
                {
                    label: 'Investments',
                    icon: 'pi pi-chart-bar',
                    command: onOpenInvestments,
                },
                {
                    label: 'Debts',
                    icon: 'pi pi-credit-card',
                    command: onOpenDebts,
                },
                {
                    label: 'Receivables',
                    icon: 'pi pi-users',
                    command: onOpenReceivables,
                },
            ],
        },
    ];

    if (isAdmin) {
        menuItems.push({
            separator: true,
        });
        menuItems.push({
            label: 'Admin',
            icon: 'pi pi-shield',
            items: [
                {
                    label: 'Users',
                    icon: 'pi pi-users',
                    command: onOpenUsers,
                },
                {
                    label: 'Settings',
                    icon: 'pi pi-cog',
                    command: onOpenSettings,
                },
            ],
        });
    }

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
            icon: isDark ? 'pi pi-sun' : 'pi pi-moon',
            command: toggleTheme,
        },
        { separator: true },
        {
            label: 'Sign Out',
            icon: 'pi pi-sign-out',
            command: () => signOut({ callbackUrl: '/auth/signin' }),
        },
    ];

    const start = (
        <Link href="/" className="flex items-center gap-2 no-underline mr-4">
            <span className="text-2xl">💰</span>
            <span className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                Sampolio
            </span>
        </Link>
    );

    const end = (
        <div className="flex items-center gap-2">
            <Menu model={userMenuItems} popup ref={userMenuRef} />
            <Button
                icon="pi pi-user"
                rounded
                text
                severity="secondary"
                onClick={(e) => userMenuRef.current?.toggle(e)}
            />
        </div>
    );

    return (
        <div className={`fixed top-0 left-0 right-0 z-50 border-b ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <Menubar
                model={menuItems}
                start={start}
                end={end}
                className="border-none rounded-none px-4"
            />
        </div>
    );
}
