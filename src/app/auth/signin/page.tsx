'use client';

import { useState, Suspense, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';

// Constants for rate limiting feedback
const MAX_ATTEMPTS_BEFORE_WARNING = 3;
const LOCKOUT_WARNING_THRESHOLD = 4;

function SignInForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get('callbackUrl') || '/';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (isLocked) {
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            const result = await signIn('credentials', {
                email: email.trim().toLowerCase(),
                password,
                redirect: false,
            });

            if (result?.error) {
                const newAttemptCount = attemptCount + 1;
                setAttemptCount(newAttemptCount);

                if (newAttemptCount >= LOCKOUT_WARNING_THRESHOLD) {
                    setError('Invalid credentials. Your account may be temporarily locked after too many failed attempts.');
                } else if (newAttemptCount >= MAX_ATTEMPTS_BEFORE_WARNING) {
                    setError(`Invalid email or password. ${5 - newAttemptCount} attempts remaining before temporary lockout.`);
                } else {
                    setError('Invalid email or password');
                }
            } else {
                // Clear attempt count on success
                setAttemptCount(0);
                router.push(callbackUrl);
                router.refresh();
            }
        } catch (err) {
            // Check if it's a rate limit error
            if (err instanceof Response && err.status === 429) {
                const data = await err.json();
                setIsLocked(true);
                setLockoutTimeRemaining(data.retryAfter || 60);
                setError('Too many login attempts. Please wait before trying again.');
            } else {
                setError('An error occurred. Please try again.');
            }
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
            <div className="text-4xl mb-2">💰</div>
            <h2 className="text-2xl font-semibold text-gray-900">Sign in to Sampolio</h2>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <Card header={header} className="w-full max-w-md shadow-lg">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                            disabled={isLocked}
                            className="w-full"
                            autoComplete="email"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="password" className="font-medium text-gray-700">
                            Password
                        </label>
                        <Password
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            disabled={isLocked}
                            feedback={false}
                            toggleMask
                            className="w-full"
                            inputClassName="w-full"
                            autoComplete="current-password"
                        />
                    </div>

                    <Button
                        type="submit"
                        label={isLocked ? `Locked (${formatTime(lockoutTimeRemaining)})` : 'Sign In'}
                        icon={isLoading ? 'pi pi-spin pi-spinner' : 'pi pi-sign-in'}
                        loading={isLoading}
                        disabled={isLocked}
                        className="w-full mt-2"
                    />
                </form>

                <p className="mt-6 text-center text-sm text-gray-600">
                    Don&apos;t have an account?{' '}
                    <Link href="/auth/signup" className="text-blue-600 hover:underline font-medium">
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
                    <i className="pi pi-spin pi-spinner text-4xl text-blue-600"></i>
                </div>
            }
        >
            <SignInForm />
        </Suspense>
    );
}
