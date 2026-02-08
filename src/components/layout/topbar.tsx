'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useRef } from 'react';
import { Button } from 'primereact/button';
import { Menubar } from 'primereact/menubar';
import { Menu } from 'primereact/menu';
import { useTheme } from '@/components/providers/theme-provider';
import { MenuItem } from 'primereact/menuitem';
import { MdAccountBalanceWallet, MdSync, MdCalendarToday, MdCalculate, MdShowChart, MdDashboard, MdBarChart, MdCreditCard, MdGroup, MdSecurity, MdSettings, MdLightMode, MdDarkMode, MdLogout, MdPerson } from 'react-icons/md';

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
            icon: <MdAccountBalanceWallet />,
            command: onOpenAccounts,
        },
        {
            label: 'Recurring',
            icon: <MdSync />,
            command: onOpenRecurring,
            disabled: !hasActiveAccounts,
        },
        {
            label: 'Planned',
            icon: <MdCalendarToday />,
            command: onOpenPlanned,
            disabled: !hasActiveAccounts,
        },
        {
            label: 'Salary',
            icon: <MdCalculate />,
            command: onOpenSalary,
            disabled: !hasActiveAccounts,
        },
        {
            separator: true,
        },
        {
            label: 'Wealth',
            icon: <MdShowChart />,
            items: [
                {
                    label: 'Dashboard',
                    icon: <MdDashboard />,
                    url: '/wealth',
                },
                {
                    separator: true,
                },
                {
                    label: 'Investments',
                    icon: <MdBarChart />,
                    command: onOpenInvestments,
                },
                {
                    label: 'Debts',
                    icon: <MdCreditCard />,
                    command: onOpenDebts,
                },
                {
                    label: 'Receivables',
                    icon: <MdGroup />,
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
            icon: <MdSecurity />,
            items: [
                {
                    label: 'Users',
                    icon: <MdGroup />,
                    command: onOpenUsers,
                },
                {
                    label: 'Settings',
                    icon: <MdSettings />,
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
                icon={<MdPerson />}
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
