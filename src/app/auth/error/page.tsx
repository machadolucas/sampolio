'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BrandLogo } from '@/components/layout/brand-logo';

// Target of Better Auth's redirect-style errors (`onAPIError.errorURL` in
// src/lib/auth/server.ts). Shows only a fixed message per known code — the
// query string is never rendered verbatim.
const MESSAGES: Record<string, string> = {
    account_inactive: 'This account is deactivated. Contact an administrator.',
    unable_to_create_session: 'We could not sign you in. Please try again.',
};
const FALLBACK = 'Something went wrong while signing you in. Please try again.';

function ErrorMessage() {
    const error = useSearchParams().get('error')?.toLowerCase();
    return <p className="text-muted-foreground mb-6">{(error && MESSAGES[error]) || FALLBACK}</p>;
}

export default function AuthErrorPage() {
    return (
        <div className="auth-shell min-h-dvh flex items-center justify-center px-4 py-8">
            <div className="auth-card w-full max-w-md border text-center">
                <div data-slot="auth-header" className="auth-brand-header glass-chrome">
                <BrandLogo size={56} className="mx-auto mb-3" />
                <h1 className="text-2xl font-semibold text-foreground mb-2">Sign-in problem</h1>
                </div>
                <div data-slot="auth-body" className="auth-form-body">
                <Suspense fallback={<p className="text-muted-foreground mb-6">{FALLBACK}</p>}>
                    <ErrorMessage />
                </Suspense>
                <Link
                    href="/auth/signin"
                    className="ui-button no-underline"
                >
                    Back to sign in
                </Link>
                </div>
            </div>
        </div>
    );
}
