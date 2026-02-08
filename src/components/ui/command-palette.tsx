'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { InputText } from 'primereact/inputtext';
import { MdHome, MdAttachMoney, MdBarChart, MdSettings, MdSync, MdAddCircle, MdRemoveCircle, MdSearch } from 'react-icons/md';
import { useTheme } from '@/components/providers/theme-provider';
import type { Command, CommandType } from '@/types';

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate?: (path: string) => void;
    onAddItem?: (type: 'income' | 'expense', yearMonth?: string, amount?: number, name?: string) => void;
    onReconcile?: () => void;
    onOpenEntity?: (entityType: string, entityId?: string) => void;
}

const NAVIGATION_COMMANDS: Command[] = [
    {
        id: 'nav-overview',
        label: 'Go to Overview',
        description: 'Wealth dashboard with net worth and projections',
        type: 'navigate',
        icon: <MdHome />,
        keywords: ['home', 'dashboard', 'wealth', 'net worth'],
        action: () => { },
    },
    {
        id: 'nav-cashflow',
        label: 'Go to Cashflow',
        description: 'Cash accounts and monthly projections',
        type: 'navigate',
        icon: <MdAttachMoney />,
        keywords: ['cash', 'flow', 'monthly', 'income', 'expense'],
        action: () => { },
    },
    {
        id: 'nav-balance-sheet',
        label: 'Go to Balance Sheet',
        description: 'Assets, investments, and debts',
        type: 'navigate',
        icon: <MdBarChart />,
        keywords: ['assets', 'debts', 'investments', 'balance', 'liabilities'],
        action: () => { },
    },
    {
        id: 'nav-settings',
        label: 'Go to Settings',
        description: 'Configure tax profiles, categories, and preferences',
        type: 'navigate',
        icon: <MdSettings />,
        keywords: ['settings', 'config', 'preferences', 'tax'],
        action: () => { },
    },
];

const ACTION_COMMANDS: Command[] = [
    {
        id: 'action-reconcile',
        label: 'Start Reconciliation',
        description: 'Update actual balances for this month',
        type: 'reconcile',
        icon: <MdSync />,
        shortcut: '⌘R',
        keywords: ['reconcile', 'update', 'actual', 'balance'],
        action: () => { },
    },
    {
        id: 'action-add-income',
        label: 'Add Income',
        description: 'Add a new income item',
        type: 'add',
        icon: <MdAddCircle />,
        keywords: ['add', 'new', 'income', 'money'],
        action: () => { },
    },
    {
        id: 'action-add-expense',
        label: 'Add Expense',
        description: 'Add a new expense item',
        type: 'add',
        icon: <MdRemoveCircle />,
        keywords: ['add', 'new', 'expense', 'spend'],
        action: () => { },
    },
];

export function CommandPalette({
    isOpen,
    onClose,
    onNavigate,
    onAddItem,
    onReconcile,
}: CommandPaletteProps) {
    const router = useRouter();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Parse natural language input like "Add 120 groceries Feb"
    const parseNaturalLanguageAdd = (input: string): { type: 'income' | 'expense'; amount?: number; name?: string; month?: string } | null => {
        const addMatch = input.match(/^add\s+(\d+(?:\.\d+)?)\s+(.+?)(?:\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))?$/i);
        if (addMatch) {
            const amount = parseFloat(addMatch[1]);
            const name = addMatch[2].trim();
            const month = addMatch[3]?.toLowerCase();
            // Determine if it's likely income or expense based on common keywords
            const incomeKeywords = ['salary', 'income', 'bonus', 'refund', 'payment received'];
            const isIncome = incomeKeywords.some(kw => name.toLowerCase().includes(kw));
            return { type: isIncome ? 'income' : 'expense', amount, name, month };
        }
        return null;
    };

    // Build all commands
    const allCommands = useMemo(() => {
        const commands: Command[] = [
            ...ACTION_COMMANDS,
            ...NAVIGATION_COMMANDS,
        ];
        return commands;
    }, []);

    // Filter commands based on query
    const filteredCommands = useMemo(() => {
        if (!query.trim()) return allCommands;

        const lowerQuery = query.toLowerCase();

        // Check for natural language add
        const parsed = parseNaturalLanguageAdd(query);
        if (parsed) {
            return [{
                id: 'dynamic-add',
                label: `Add ${parsed.type}: ${parsed.name}`,
                description: parsed.amount ? `€${parsed.amount}${parsed.month ? ` in ${parsed.month}` : ''}` : undefined,
                type: 'add' as CommandType,
                icon: parsed.type === 'income' ? <MdAddCircle /> : <MdRemoveCircle />,
                shortcut: undefined,
                keywords: [] as string[],
                action: () => onAddItem?.(parsed.type, parsed.month, parsed.amount, parsed.name),
            } satisfies Command];
        }

        return allCommands.filter(cmd => {
            const searchText = [cmd.label, cmd.description, ...(cmd.keywords || [])].join(' ').toLowerCase();
            return searchText.includes(lowerQuery);
        });
    }, [query, allCommands, onAddItem]);

    const executeCommand = useCallback((command: Command) => {
        switch (command.type) {
            case 'navigate': {
                const paths: Record<string, string> = {
                    'nav-overview': '/',
                    'nav-cashflow': '/cashflow',
                    'nav-balance-sheet': '/balance-sheet',
                    'nav-settings': '/settings',
                };
                const path = paths[command.id];
                if (path) {
                    if (onNavigate) {
                        onNavigate(path);
                    } else {
                        router.push(path);
                    }
                }
                break;
            }
            case 'reconcile':
                onReconcile?.();
                break;
            case 'add':
                if (command.id === 'action-add-income') {
                    onAddItem?.('income');
                } else if (command.id === 'action-add-expense') {
                    onAddItem?.('expense');
                } else {
                    command.action();
                }
                break;
            default:
                command.action();
        }
        onClose();
    }, [onNavigate, onReconcile, onAddItem, onClose, router]);

    // Handle keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(i => Math.max(i - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (filteredCommands[selectedIndex]) {
                        executeCommand(filteredCommands[selectedIndex]);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredCommands, selectedIndex, onClose, executeCommand]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Reset selection when filtered results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const getTypeColor = (type: CommandType) => {
        switch (type) {
            case 'navigate': return isDark ? 'text-blue-400' : 'text-blue-600';
            case 'add': return isDark ? 'text-green-400' : 'text-green-600';
            case 'reconcile': return isDark ? 'text-purple-400' : 'text-purple-600';
            default: return isDark ? 'text-gray-400' : 'text-gray-600';
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-50 bg-black/50"
                onClick={onClose}
            />

            {/* Palette */}
            <div
                className={`fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-xl rounded-xl shadow-2xl overflow-hidden ${isDark ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200'
                    }`}
            >
                {/* Search Input */}
                <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <MdSearch className={isDark ? 'text-gray-400' : 'text-gray-500'} />
                    <InputText
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Type a command or search..."
                        className="flex-1 border-none shadow-none p-0 focus:ring-0"
                        style={{ background: 'transparent' }}
                    />
                    <kbd className={`px-2 py-0.5 text-xs rounded ${isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'
                        }`}>
                        ESC
                    </kbd>
                </div>

                {/* Results */}
                <div className="max-h-80 overflow-y-auto py-2">
                    {filteredCommands.length === 0 ? (
                        <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            <MdSearch size={24} className="mb-2" />
                            <p>No results found</p>
                        </div>
                    ) : (
                        filteredCommands.map((command, index) => (
                            <button
                                key={command.id}
                                onClick={() => executeCommand(command)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${index === selectedIndex
                                    ? isDark ? 'bg-gray-800' : 'bg-gray-100'
                                    : isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
                                    }`}
                            >
                                <span className={getTypeColor(command.type)}>{command.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className={isDark ? 'text-gray-100' : 'text-gray-900'}>
                                        {command.label}
                                    </div>
                                    {command.description && (
                                        <div className={`text-sm truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {command.description}
                                        </div>
                                    )}
                                </div>
                                {command.shortcut && (
                                    <kbd className={`px-2 py-0.5 text-xs rounded ${isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                        {command.shortcut}
                                    </kbd>
                                )}
                            </button>
                        ))
                    )}
                </div>

                {/* Footer Hint */}
                <div className={`px-4 py-2 border-t text-xs ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'
                    }`}>
                    <span>Try: </span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>&quot;add 120 groceries feb&quot;</span>
                    <span> or </span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>&quot;go to cashflow&quot;</span>
                </div>
            </div>
        </>
    );
}

// Hook for keyboard shortcuts
export function useCommandPalette(shortcuts?: {
    onReconcile?: () => void;
    onAddIncome?: () => void;
    onAddExpense?: () => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle shortcuts when typing in inputs
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
                return;
            }

            // Only handle other shortcuts when not in an input
            if (isInput) return;

            if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
                e.preventDefault();
                shortcuts?.onReconcile?.();
                return;
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
                e.preventDefault();
                shortcuts?.onAddIncome?.();
                return;
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                shortcuts?.onAddExpense?.();
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [shortcuts]);

    return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen(prev => !prev),
    };
}
