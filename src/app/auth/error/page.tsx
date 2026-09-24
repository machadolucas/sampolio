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
    return <p className="text-gray-600 mb-6">{(error && MESSAGES[error]) || FALLBACK}</p>;
}

export default function AuthErrorPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-lg p-6 text-center">
                <BrandLogo size={56} className="mx-auto mb-3" />
                <h1 className="text-2xl font-semibold text-gray-900 mb-2">Sign-in problem</h1>
                <Suspense fallback={<p className="text-gray-600 mb-6">{FALLBACK}</p>}>
                    <ErrorMessage />
                </Suspense>
                <Link
                    href="/auth/signin"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent-600 px-5 font-medium text-white hover:bg-accent-700"
                >
                    Back to sign in
                </Link>
            </div>
        </div>
    );
}
