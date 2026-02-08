'use client';

import { useEffect, useRef } from 'react';
import { Button } from 'primereact/button';
import { MdClose } from 'react-icons/md';
import { useTheme } from '@/components/providers/theme-provider';
import type { DrawerState } from '@/types';

interface DrawerEditorProps {
    state: DrawerState;
    onClose: () => void;
    title?: string;
    subtitle?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    width?: 'sm' | 'md' | 'lg' | 'xl';
}

const widthClasses = {
    sm: 'w-80',
    md: 'w-96',
    lg: 'w-[28rem]',
    xl: 'w-[32rem]',
};

export function DrawerEditor({
    state,
    onClose,
    title,
    subtitle,
    children,
    footer,
    width = 'md',
}: DrawerEditorProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const drawerRef = useRef<HTMLDivElement>(null);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && state.isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [state.isOpen, onClose]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (state.isOpen && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        if (state.isOpen) {
            // Delay to prevent immediate close on open click
            setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [state.isOpen, onClose]);

    // Prevent body scroll when drawer is open
    useEffect(() => {
        if (state.isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [state.isOpen]);

    if (!state.isOpen) return null;

    const modeLabel = state.mode === 'create' ? 'New' : state.mode === 'edit' ? 'Edit' : 'View';
    const displayTitle = title || `${modeLabel} Item`;

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 z-40 transition-opacity duration-300 ${state.isOpen ? 'opacity-50' : 'opacity-0 pointer-events-none'
                    } ${isDark ? 'bg-black' : 'bg-gray-900'}`}
            />

            {/* Drawer */}
            <div
                ref={drawerRef}
                className={`fixed top-0 right-0 h-full z-50 flex flex-col shadow-2xl transition-transform duration-300 ${widthClasses[width]
                    } ${state.isOpen ? 'translate-x-0' : 'translate-x-full'} ${isDark ? 'bg-gray-900 border-l border-gray-700' : 'bg-white border-l border-gray-200'
                    }`}
            >
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'
                    }`}>
                    <div>
                        <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {displayTitle}
                        </h2>
                        {subtitle && (
                            <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <Button
                        icon={<MdClose />}
                        rounded
                        text
                        severity="secondary"
                        onClick={onClose}
                    />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className={`px-6 py-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                        {footer}
                    </div>
                )}
            </div>
        </>
    );
}

// Inline edit component for quick edits
interface InlineEditProps {
    value: string | number;
    onSave: (value: string | number) => void;
    type?: 'text' | 'number' | 'currency';
    className?: string;
}

export function InlineEdit({
    value,
    onSave,
    type = 'text',
    className = '',
}: InlineEditProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const inputRef = useRef<HTMLInputElement>(null);

    const handleBlur = () => {
        if (inputRef.current) {
            const newValue = type === 'number' || type === 'currency'
                ? parseFloat(inputRef.current.value) || 0
                : inputRef.current.value;
            if (newValue !== value) {
                onSave(newValue);
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
            if (inputRef.current) {
                inputRef.current.value = String(value);
            }
            (e.target as HTMLInputElement).blur();
        }
    };

    return (
        <input
            ref={inputRef}
            type={type === 'text' ? 'text' : 'number'}
            defaultValue={value}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className={`px-2 py-1 rounded border transition-colors ${isDark
                ? 'bg-gray-800 border-gray-700 text-gray-100 focus:border-blue-500'
                : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                } focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${className}`}
        />
    );
}
