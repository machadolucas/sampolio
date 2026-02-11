'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Chip } from 'primereact/chip';
import { Divider } from 'primereact/divider';
import { Message } from 'primereact/message';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { getSettings, updateSettings, revalidateAllCaches } from '@/lib/actions/admin';
import { getUserPreferences, updateCategories, updateTaxDefaults } from '@/lib/actions/user-preferences';
import { getAppVersion } from '@/lib/actions/app-info';
import { ITEM_CATEGORIES } from '@/lib/constants';
import type { TaxDefaults } from '@/types';
import { MdDownload, MdUpload, MdAccountBalanceWallet, MdAdd, MdCheck, MdGroup, MdCached } from 'react-icons/md';
import { FaGithub } from 'react-icons/fa';

export default function SettingsPage() {
    const { data: session } = useSession();
    const { theme, toggleTheme } = useTheme();
    const appContext = useAppContext();
    const isDark = theme === 'dark';
    const isAdmin = session?.user?.role === 'admin';

    const [selfSignupEnabled, setSelfSignupEnabled] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Categories state
    const [customCategories, setCustomCategories] = useState<string[]>([]);
    const [removedDefaults, setRemovedDefaults] = useState<string[]>([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [categoriesMessage, setCategoriesMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isSavingCategories, setIsSavingCategories] = useState(false);

    // Tax defaults state
    const [taxDefaults, setTaxDefaults] = useState<TaxDefaults>({ taxRate: 0, contributionsRate: 0, otherDeductions: 0 });
    const [taxMessage, setTaxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isSavingTax, setIsSavingTax] = useState(false);

    // App version
    const [appVersion, setAppVersion] = useState<string>('');

    // Cache revalidation state
    const [isRevalidating, setIsRevalidating] = useState(false);

    // Active categories = built-in minus removed + custom
    const activeCategories = [
        ...ITEM_CATEGORIES.filter(c => !removedDefaults.includes(c)),
        ...customCategories,
    ];

    useEffect(() => {
        async function loadSettings() {
            if (isAdmin) {
                const result = await getSettings();
                if (result.success && result.data) {
                    setSelfSignupEnabled(result.data.selfSignupEnabled);
                }
            }
        }
        async function loadPreferences() {
            const result = await getUserPreferences();
            if (result.success && result.data) {
                setCustomCategories(result.data.customCategories ?? []);
                setRemovedDefaults(result.data.removedDefaultCategories ?? []);
                if (result.data.taxDefaults) {
                    setTaxDefaults(result.data.taxDefaults);
                }
            }
        }
        async function loadAppInfo() {
            const result = await getAppVersion();
            if (result.success) {
                setAppVersion(result.version);
            }
        }
        loadSettings();
        loadPreferences();
        loadAppInfo();
    }, [isAdmin]);

    const handleSaveAdminSettings = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const result = await updateSettings({ selfSignupEnabled });
            if (result.success) {
                setMessage({ type: 'success', text: 'Settings saved successfully' });
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to save settings' });
            }
        } catch {
            setMessage({ type: 'error', text: 'An error occurred' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRevalidateAllCaches = async () => {
        setIsRevalidating(true);
        try {
            const result = await revalidateAllCaches();
            if (result.success) {
                setMessage({ type: 'success', text: 'All caches revalidated successfully' });
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to revalidate caches' });
            }
        } catch {
            setMessage({ type: 'error', text: 'An error occurred while revalidating caches' });
        } finally {
            setIsRevalidating(false);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Header */}
            <div>
                <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Settings
                </h1>
                <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Configure your preferences and application settings
                </p>
            </div>

            {/* Appearance */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Appearance
                </h2>

                <div className="flex items-center justify-between">
                    <div>
                        <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Dark Mode</p>
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Use dark theme for the interface
                        </p>
                    </div>
                    <InputSwitch
                        checked={isDark}
                        onChange={toggleTheme}
                    />
                </div>
            </Card>

            {/* Keyboard Shortcuts */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Keyboard Shortcuts
                </h2>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>
                            Open Command Palette
                        </span>
                        <kbd className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}>
                            ⌘K
                        </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>
                            Quick Add Income
                        </span>
                        <kbd className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}>
                            ⌘I
                        </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>
                            Quick Add Expense
                        </span>
                        <kbd className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}>
                            ⌘E
                        </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>
                            Start Reconciliation
                        </span>
                        <kbd className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}>
                            ⌘R
                        </kbd>
                    </div>
                </div>
            </Card>

            {/* Data & Export */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Data & Export
                </h2>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Export Data</p>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                Download all your financial data as JSON
                            </p>
                        </div>
                        <Button
                            label="Export"
                            icon={<MdDownload />}
                            outlined
                            size="small"
                        />
                    </div>
                    <Divider />
                    <div className="flex items-center justify-between">
                        <div>
                            <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Import Data</p>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                Import financial data from a backup
                            </p>
                        </div>
                        <Button
                            label="Import"
                            icon={<MdUpload />}
                            outlined
                            size="small"
                        />
                    </div>
                </div>
            </Card>

            {/* Accounts */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Accounts
                </h2>

                <p className={`mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Manage, archive, or remove your cash accounts
                </p>

                <Button
                    label="Manage Accounts"
                    icon={<MdAccountBalanceWallet />}
                    outlined
                    onClick={() => appContext?.openDrawer({ mode: 'view', entityType: 'account' })}
                />
            </Card>

            {/* Categories */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Categories
                </h2>

                <p className={`mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Manage categories for income and expenses. Click ✕ to remove a category.
                </p>

                {categoriesMessage && (
                    <Message severity={categoriesMessage.type} text={categoriesMessage.text} className="w-full mb-4" />
                )}

                <div className="flex flex-wrap gap-2 mb-4">
                    {activeCategories.map(cat => (
                        <Chip
                            key={cat}
                            label={cat}
                            removable
                            onRemove={() => {
                                if (ITEM_CATEGORIES.includes(cat)) {
                                    setRemovedDefaults(prev => [...prev, cat]);
                                } else {
                                    setCustomCategories(prev => prev.filter(c => c !== cat));
                                }
                                return true;
                            }}
                        />
                    ))}
                </div>

                {removedDefaults.length > 0 && (
                    <div className="mb-4">
                        <p className={`text-xs mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Removed defaults (click to restore):</p>
                        <div className="flex flex-wrap gap-1">
                            {removedDefaults.map(cat => (
                                <Chip
                                    key={cat}
                                    label={cat}
                                    className="opacity-50 cursor-pointer"
                                    onClick={() => setRemovedDefaults(prev => prev.filter(c => c !== cat))}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-2 mb-4">
                    <InputText
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                        placeholder="New category name"
                        className="flex-1"
                        onKeyDown={e => {
                            if (e.key === 'Enter' && newCategoryName.trim()) {
                                const name = newCategoryName.trim();
                                if (!activeCategories.includes(name)) {
                                    setCustomCategories(prev => [...prev, name]);
                                }
                                setNewCategoryName('');
                            }
                        }}
                    />
                    <Button
                        icon={<MdAdd />}
                        outlined
                        disabled={!newCategoryName.trim() || activeCategories.includes(newCategoryName.trim())}
                        onClick={() => {
                            const name = newCategoryName.trim();
                            if (name && !activeCategories.includes(name)) {
                                setCustomCategories(prev => [...prev, name]);
                            }
                            setNewCategoryName('');
                        }}
                    />
                </div>

                <Button
                    label="Save Categories"
                    icon={<MdCheck />}
                    size="small"
                    onClick={async () => {
                        setIsSavingCategories(true);
                        setCategoriesMessage(null);
                        try {
                            const result = await updateCategories(customCategories, removedDefaults);
                            setCategoriesMessage(result.success
                                ? { type: 'success', text: 'Categories saved' }
                                : { type: 'error', text: result.error || 'Failed' });
                        } catch {
                            setCategoriesMessage({ type: 'error', text: 'An error occurred' });
                        } finally {
                            setIsSavingCategories(false);
                        }
                    }}
                    loading={isSavingCategories}
                />
            </Card>

            {/* Tax Defaults */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Tax &amp; Contribution Defaults
                </h2>

                <p className={`mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Set default tax and contribution rates. These will be pre-filled when creating new salary configurations.
                </p>

                {taxMessage && (
                    <Message severity={taxMessage.type} text={taxMessage.text} className="w-full mb-4" />
                )}

                <div className="space-y-4 max-w-md">
                    <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Default Tax Rate (%)
                        </label>
                        <InputNumber
                            value={taxDefaults.taxRate}
                            onValueChange={e => setTaxDefaults(prev => ({ ...prev, taxRate: e.value ?? 0 }))}
                            suffix="%"
                            locale="fi-FI"
                            min={0}
                            max={100}
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            className="w-full"
                        />
                    </div>
                    <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Default Contributions Rate (%)
                        </label>
                        <InputNumber
                            value={taxDefaults.contributionsRate}
                            onValueChange={e => setTaxDefaults(prev => ({ ...prev, contributionsRate: e.value ?? 0 }))}
                            suffix="%"
                            locale="fi-FI"
                            min={0}
                            max={100}
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            className="w-full"
                        />
                    </div>
                    <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Default Other Deductions (fixed amount)
                        </label>
                        <InputNumber
                            value={taxDefaults.otherDeductions}
                            onValueChange={e => setTaxDefaults(prev => ({ ...prev, otherDeductions: e.value ?? 0 }))}
                            mode="currency"
                            currency="EUR"
                            locale="fi-FI"
                            min={0}
                            className="w-full"
                        />
                    </div>
                </div>

                <div className="mt-4">
                    <Button
                        label="Save Tax Defaults"
                        icon={<MdCheck />}
                        size="small"
                        onClick={async () => {
                            setIsSavingTax(true);
                            setTaxMessage(null);
                            try {
                                const result = await updateTaxDefaults(taxDefaults);
                                setTaxMessage(result.success
                                    ? { type: 'success', text: 'Tax defaults saved' }
                                    : { type: 'error', text: result.error || 'Failed' });
                            } catch {
                                setTaxMessage({ type: 'error', text: 'An error occurred' });
                            } finally {
                                setIsSavingTax(false);
                            }
                        }}
                        loading={isSavingTax}
                    />
                </div>
            </Card>

            {/* Admin Settings */}
            {isAdmin && (
                <Card>
                    <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        Admin Settings
                    </h2>

                    {message && (
                        <Message
                            severity={message.type}
                            text={message.text}
                            className="w-full mb-4"
                        />
                    )}

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Allow Self-Signup</p>
                                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Enable new users to register without admin approval
                                </p>
                            </div>
                            <InputSwitch
                                checked={selfSignupEnabled}
                                onChange={(e) => setSelfSignupEnabled(e.value)}
                            />
                        </div>

                        <Divider />

                        <div className="flex items-center justify-between">
                            <div>
                                <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Manage Users</p>
                                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    View and manage user accounts
                                </p>
                            </div>
                            <Button
                                label="Users"
                                icon={<MdGroup />}
                                outlined
                                size="small"
                                onClick={() => appContext?.openDrawer({ mode: 'view', entityType: 'users' })}
                            />
                        </div>

                        <Divider />

                        <div className="flex items-center justify-between">
                            <div>
                                <p className={isDark ? 'text-gray-200' : 'text-gray-700'}>Force Revalidate Caches</p>
                                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Clear all in-memory data caches and force fresh reads from disk
                                </p>
                            </div>
                            <Button
                                label="Revalidate"
                                icon={<MdCached />}
                                outlined
                                severity="warning"
                                size="small"
                                onClick={handleRevalidateAllCaches}
                                loading={isRevalidating}
                            />
                        </div>

                        <div className="flex justify-end">
                            <Button
                                label="Save Admin Settings"
                                icon={<MdCheck />}
                                onClick={handleSaveAdminSettings}
                                loading={isSaving}
                            />
                        </div>
                    </div>
                </Card>
            )}

            {/* About */}
            <Card>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    About
                </h2>

                <div className="space-y-2">
                    <p className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                        <strong>Sampolio</strong> - Personal Finance Planning Tool
                    </p>

                    {appVersion && (
                        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            Version {appVersion}
                        </p>
                    )}

                    <div className="pt-2">
                        <a
                            href="https://github.com/machadolucas/sampolio"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 text-sm hover:underline ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                        >
                            <FaGithub />
                            View on GitHub
                        </a>
                    </div>
                </div>
            </Card>
        </div>
    );
}
