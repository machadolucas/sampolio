import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
    // Simple implementation without tailwind-merge for now
    return inputs.filter(Boolean).join(' ');
}
