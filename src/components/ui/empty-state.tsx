'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    body?: React.ReactNode;
    action?: { label: string; onClick: () => void; icon?: React.ReactNode };
    className?: string;
}

/** Shared empty-state block: icon, one-line title, optional body + action. */
export function EmptyState({ icon, title, body, action, className = '' }: EmptyStateProps) {

    return (
        <div className={`flex flex-col items-center justify-center gap-2 py-10 px-4 text-center ${className}`}>
            {icon && (
                <div className="mb-2 flex size-16 items-center justify-center rounded-2xl border border-border bg-muted text-3xl text-muted-foreground shadow-sm" aria-hidden>
                    {icon}
                </div>
            )}
            <p className="font-semibold text-foreground">{title}</p>
            {body && (
                <p className="text-sm max-w-md text-muted-foreground">{body}</p>
            )}
            {action && (
                <Button
                    label={action.label}
                    icon={action.icon}
                    size="small"
                    outlined
                    className="mt-2"
                    onClick={action.onClick}
                />
            )}
        </div>
    );
}
