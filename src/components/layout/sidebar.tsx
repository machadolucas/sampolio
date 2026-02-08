'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import { Button } from 'primereact/button';
import { Sidebar as PrimeSidebar } from 'primereact/sidebar';
import { Badge } from 'primereact/badge';
import { Divider } from 'primereact/divider';
import { useTheme } from '@/components/providers/theme-provider';
import { MdHome, MdAccountBalanceWallet, MdSync, MdCalendarToday, MdCalculate, MdGroup, MdSettings, MdPerson, MdLightMode, MdDarkMode, MdLogout, MdMenu } from 'react-icons/md';

const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: <MdHome size={18} /> },
    { name: 'Accounts', href: '/accounts', icon: <MdAccountBalanceWallet size={18} /> },
    { name: 'Recurring', href: '/recurring', icon: <MdSync size={18} /> },
    { name: 'Planned', href: '/planned', icon: <MdCalendarToday size={18} /> },
    { name: 'Salary Calculator', href: '/salary', icon: <MdCalculate size={18} /> },
];

const adminNavigation = [
    { name: 'Users', href: '/admin/users', icon: <MdGroup size={18} /> },
    { name: 'Settings', href: '/admin/settings', icon: <MdSettings size={18} /> },
];

export function Sidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { theme, toggleTheme } = useTheme();

    const isActive = (href: string) => {
        if (href === '/dashboard') {
            return pathname === '/dashboard';
        }
        return pathname.startsWith(href);
    };

    const isAdmin = session?.user?.role === 'admin';
    const isDark = theme === 'dark';

    const navLinksContent = (
        <div className="flex flex-col gap-1">
            {navigation.map((item) => {
                const active = isActive(item.href);
                return (
                    <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors no-underline
                            ${active
                                ? 'bg-blue-600 text-white'
                                : isDark
                                    ? 'text-gray-300 hover:bg-gray-700'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        onClick={() => setIsMobileMenuOpen(false)}
                    >
                        {item.icon}
                        {item.name}
                    </Link>
                );
            })}

            {isAdmin && (
                <>
                    <Divider className="my-2" />
                    <span className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Admin
                    </span>
                    {adminNavigation.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors no-underline
                                    ${active
                                        ? 'bg-purple-600 text-white'
                                        : isDark
                                            ? 'text-gray-300 hover:bg-gray-700'
                                            : 'text-gray-700 hover:bg-gray-100'
                                    }`}
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                {item.icon}
                                {item.name}
                            </Link>
                        );
                    })}
                </>
            )}
        </div>
    );

    const userSection = (
        <div className="py-2">
            <div className="flex items-center gap-2 px-4 py-2">
                <MdPerson className={isDark ? 'text-gray-400' : 'text-gray-500'} />
                <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {session?.user?.name}
                    </div>
                    <div className={`text-xs truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {session?.user?.email}
                    </div>
                </div>
                {isAdmin && (
                    <Badge value="Admin" severity="info" />
                )}
            </div>
            <div className="flex gap-2 mt-2">
                <Button
                    icon={isDark ? <MdLightMode /> : <MdDarkMode />}
                    severity="secondary"
                    text
                    tooltip={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    tooltipOptions={{ position: 'top' }}
                    onClick={toggleTheme}
                />
                <Button
                    label="Sign Out"
                    icon={<MdLogout />}
                    severity="secondary"
                    text
                    className="flex-1 justify-start"
                    onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                />
            </div>
        </div>
    );

    return (
        <>
            {/* Mobile menu button */}
            <div className={`lg:hidden fixed top-0 left-0 right-0 z-40 border-b px-4 py-3 ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center justify-between">
                    <Link href="/dashboard" className={`text-xl font-bold no-underline ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        💰 Sampolio
                    </Link>
                    <div className="flex gap-2">
                        <Button
                            icon={isDark ? <MdLightMode /> : <MdDarkMode />}
                            severity="secondary"
                            text
                            onClick={toggleTheme}
                        />
                        <Button
                            icon={<MdMenu />}
                            severity="secondary"
                            text
                            onClick={() => setIsMobileMenuOpen(true)}
                        />
                    </div>
                </div>
            </div>

            {/* Mobile sidebar */}
            <PrimeSidebar
                visible={isMobileMenuOpen}
                onHide={() => setIsMobileMenuOpen(false)}
                className="w-72"
            >
                <div className="flex flex-col h-full">
                    <div className="mb-4">
                        <span className="text-xl font-bold">💰 Sampolio</span>
                    </div>
                    <nav className="flex-1 overflow-y-auto">
                        {navLinksContent}
                    </nav>
                    <Divider />
                    {userSection}
                </div>
            </PrimeSidebar>

            {/* Desktop sidebar */}
            <aside className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 border-r transition-colors ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                {/* Logo */}
                <div className={`px-6 py-5 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <Link href="/dashboard" className={`text-2xl font-bold no-underline ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        💰 Sampolio
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-4 overflow-y-auto">
                    {navLinksContent}
                </nav>

                {/* User section */}
                <div className={`px-4 py-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    {userSection}
                </div>
            </aside>
        </>
    );
}
