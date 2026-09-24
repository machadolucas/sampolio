'use client';

import { useState, Suspense, useEffect, useRef } from 'react';
import { authClient } from '@/lib/auth-client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { BrandLogo } from '@/components/layout/brand-logo';
import { MdLogin, MdSync, MdFingerprint } from 'react-icons/md';
import { signInSchema, type SignInFormData } from '@/lib/schemas/auth.schema';

// Constants for rate limiting feedback.
// Keep MAX_FAILED_ATTEMPTS in sync with the server-side value in src/lib/db/users.ts.
const MAX_FAILED_ATTEMPTS = 10;
const MAX_ATTEMPTS_BEFORE_WARNING = 7;
const LOCKOUT_WARNING_THRESHOLD = 9;

/** Only same-origin relative paths are allowed as a post-sign-in target. */
function safeCallbackUrl(raw: string | null): string {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
    return raw;
}

type AuthError = { status?: number; code?: string; message?: string; retryAfter?: number } | null | undefined;

function SignInForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));

    const {
        register,
        handleSubmit,
        control,
        formState: { errors },
    } = useForm<SignInFormData>({
        resolver: zodResolver(signInSchema),
        defaultValues: {
            email: '',
            password: '',
        },
    });

    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [attemptCount, setAttemptCount] = useState(0);
    const [isLocked, setIsLocked] = useState(false);
    const [lockoutTimeRemaining, setLockoutTimeRemaining] = useState(0);

    const lockoutTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (lockoutTimerRef.current) {
                clearInterval(lockoutTimerRef.current);
            }
        };
    }, []);

    // Handle lockout countdown
    useEffect(() => {
        if (lockoutTimeRemaining > 0) {
            lockoutTimerRef.current = setInterval(() => {
                setLockoutTimeRemaining((prev) => {
                    if (prev <= 1) {
                        setIsLocked(false);
                        if (lockoutTimerRef.current) {
                            clearInterval(lockoutTimerRef.current);
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        return () => {
            if (lockoutTimerRef.current) {
                clearInterval(lockoutTimerRef.current);
            }
        };
    }, [lockoutTimeRemaining]);

    const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);

    // No router.refresh() here: it would re-request /auth/signin (the current
    // route) WITH the fresh session cookie, and the proxy's stale-cookie sweep
    // on auth pages would then expire that brand-new cookie.
    const onSignedIn = () => {
        setAttemptCount(0);
        router.replace(callbackUrl);
    };

    const applyLockout = (err: NonNullable<AuthError>) => {
        setIsLocked(true);
        setLockoutTimeRemaining(err.retryAfter && err.retryAfter > 0 ? Math.ceil(err.retryAfter) : 60);
        setError('Too many login attempts. Please wait before trying again.');
    };

    // Conditional UI: offer saved passkeys in the email field's autofill.
    // Runs once; the pending request is aborted automatically when the user
    // clicks "Sign in with passkey" (a new WebAuthn ceremony supersedes it).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (typeof window === 'undefined' || !window.PublicKeyCredential?.isConditionalMediationAvailable) return;
            if (!(await window.PublicKeyCredential.isConditionalMediationAvailable())) return;
            const result = await authClient.signIn.passkey({ autoFill: true });
            if (cancelled) return;
            if (result?.data) {
                onSignedIn();
            } else if ((result?.error as AuthError)?.code === 'ACCOUNT_INACTIVE') {
                setError(result.error?.message ?? 'This account is deactivated.');
            }
        })().catch(() => { /* autofill aborted or unsupported */ });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onPasskeySignIn = async () => {
        setError('');
        setIsPasskeyLoading(true);
        try {
            const result = await authClient.signIn.passkey();
            const err = result?.error as AuthError;
            if (!err && result?.data) {
                onSignedIn();
                return;
            }
            if (err?.status === 429) {
                applyLockout(err);
            } else if (err?.code === 'ACCOUNT_INACTIVE') {
                setError(err.message ?? 'This account is deactivated.');
            } else if (err?.code === 'AUTH_CANCELLED' || err?.code === 'ERROR_CEREMONY_ABORTED') {
                // User dismissed the browser prompt — no error banner.
            } else {
                setError('Passkey sign-in failed. Try again or use your password.');
            }
        } catch {
            setError('Passkey sign-in failed. Try again or use your password.');
        } finally {
            setIsPasskeyLoading(false);
        }
    };

    const onSubmit = async (data: SignInFormData) => {
        if (isLocked) {
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            const { error: signInError } = await authClient.signIn.email({
                email: data.email.trim().toLowerCase(),
                password: data.password,
            });
            const err = signInError as AuthError;

            if (!err) {
                onSignedIn();
                return;
            }

            if (err.status === 429) {
                applyLockout(err);
            } else if (err.code === 'ACCOUNT_INACTIVE') {
                setError(err.message ?? 'This account is deactivated.');
            } else if (err.status === 401) {
                const newAttemptCount = attemptCount + 1;
                setAttemptCount(newAttemptCount);

                if (newAttemptCount >= LOCKOUT_WARNING_THRESHOLD) {
                    setError('Invalid credentials. Your account may be temporarily locked after too many failed attempts.');
                } else if (newAttemptCount >= MAX_ATTEMPTS_BEFORE_WARNING) {
                    setError(`Invalid email or password. ${MAX_FAILED_ATTEMPTS - newAttemptCount} attempts remaining before temporary lockout.`);
                } else {
                    setError('Invalid email or password');
                }
            } else {
                setError('An error occurred. Please try again.');
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    const header = (
        <div className="text-center pt-4">
            <BrandLogo size={56} className="mx-auto mb-3" />
            <h2 className="text-2xl font-bold  text-gray-900">Sign in to Sampolio</h2>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <Card header={header} className="w-full max-w-md shadow-lg">
                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                    {error && (
                        <Message severity="error" text={error} className="w-full" />
                    )}

                    {isLocked && lockoutTimeRemaining > 0 && (
                        <Message
                            severity="warn"
                            text={`Please wait ${formatTime(lockoutTimeRemaining)} before trying again.`}
                            className="w-full"
                        />
                    )}

                    <div className="flex flex-col gap-2">
                        <label htmlFor="email" className="font-medium text-gray-700">
                            Email
                        </label>
                        <InputText
                            id="email"
                            type="email"
                            {...register('email')}
                            placeholder="you@example.com"
                            disabled={isLocked}
                            className="w-full"
                            autoComplete="username webauthn"
                        />
                        {errors.email && (
                            <small className="text-red-500">{errors.email.message}</small>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="password" className="font-medium text-gray-700">
                            Password
                        </label>
                        <Controller
                            name="password"
                            control={control}
                            render={({ field }) => (
                                <Password
                                    id="password"
                                    value={field.value}
                                    onChange={(e) => field.onChange(e.target.value)}
                                    placeholder="••••••••"
                                    disabled={isLocked}
                                    feedback={false}
                                    toggleMask
                                    className="w-full"
                                    inputClassName="w-full"
                                    autoComplete="current-password"
                                />
                            )}
                        />
                        {errors.password && (
                            <small className="text-red-500">{errors.password.message}</small>
                        )}
                    </div>

                    <Button
                        type="submit"
                        label={isLocked ? `Locked (${formatTime(lockoutTimeRemaining)})` : 'Sign In'}
                        icon={<MdLogin />}
                        loading={isLoading}
                        disabled={isLocked}
                        className="w-full mt-2"
                    />
                </form>

                <div className="flex items-center gap-3 my-4" aria-hidden="true">
                    <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    <span className="text-xs text-gray-500">or</span>
                    <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>

                <Button
                    type="button"
                    label="Sign in with passkey"
                    icon={<MdFingerprint />}
                    outlined
                    loading={isPasskeyLoading}
                    disabled={isLocked}
                    onClick={onPasskeySignIn}
                    className="w-full"
                />

                <p className="mt-6 text-center text-sm text-gray-600">
                    Don&apos;t have an account?{' '}
                    <Link href="/auth/signup" className="text-accent-600 hover:underline font-medium">
                        Sign up
                    </Link>
                </p>
            </Card>
        </div>
    );
}

export default function SignInPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-gray-50">
                    <MdSync size={36} className="text-accent-600 animate-spin" />
                </div>
            }
        >
            <SignInForm />
        </Suspense>
    );
}
