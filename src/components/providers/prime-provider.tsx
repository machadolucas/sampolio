'use client';

import { PrimeReactProvider } from 'primereact/api';
import 'primereact/resources/themes/lara-light-blue/theme.css';

interface PrimeProviderProps {
    children: React.ReactNode;
}

export function PrimeProvider({ children }: PrimeProviderProps) {
    return (
        <PrimeReactProvider>
            {children}
        </PrimeReactProvider>
    );
}
