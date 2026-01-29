'use client';

import { createContext, useContext, useEffect, useState, useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: React.ReactNode;
}

// SSR-safe check for client-side mounting
const emptySubscribe = () => () => { };
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>('light');
    const isClient = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);

    const applyTheme = useCallback((newTheme: Theme) => {
        const root = document.documentElement;

        // Remove existing theme link if any
        const existingLink = document.getElementById('primereact-theme');
        if (existingLink) {
            existingLink.remove();
        }

        // Create new theme link
        const link = document.createElement('link');
        link.id = 'primereact-theme';
        link.rel = 'stylesheet';
        link.href = newTheme === 'dark'
            ? '/themes/mdc-dark-deeppurple.css'
            : '/themes/mdc-light-deeppurple.css';
        document.head.appendChild(link);

        // Update HTML class for Tailwind dark mode
        if (newTheme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

        // Update CSS variables for backgrounds
        if (newTheme === 'dark') {
            root.style.setProperty('--background', '#121212');
            root.style.setProperty('--foreground', '#ededed');
        } else {
            root.style.setProperty('--background', '#ffffff');
            root.style.setProperty('--foreground', '#171717');
        }
    }, []);

    useEffect(() => {
        if (!isClient) return;

        // Check localStorage first
        const savedTheme = localStorage.getItem('sampolio-theme') as Theme | null;
        if (savedTheme) {
            setThemeState(savedTheme);
            applyTheme(savedTheme);
        } else {
            // Check system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const initialTheme = prefersDark ? 'dark' : 'light';
            setThemeState(initialTheme);
            applyTheme(initialTheme);
        }
    }, [applyTheme, isClient]);

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('sampolio-theme', newTheme);
        applyTheme(newTheme);
    }, [applyTheme]);

    const toggleTheme = useCallback(() => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
    }, [theme, setTheme]);

    if (!isClient) {
        return null;
    }

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
