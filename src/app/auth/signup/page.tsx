'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { signUp, checkSignupEnabled } from '@/lib/actions/auth';

export default function SignUpPage() {
    const router = useRouter();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Check if this might be the first user (for messaging purposes)
        checkSignupEnabled().catch(() => { }); // Ignore errors
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        // Client-side password validation (server also validates)
        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }
        if (!/[a-z]/.test(password)) {
            setError('Password must contain at least one lowercase letter');
            return;
        }
        if (!/[A-Z]/.test(password)) {
            setError('Password must contain at least one uppercase letter');
            return;
        }
        if (!/[0-9]/.test(password)) {
            setError('Password must contain at least one number');
            return;
        }
        if (!/[^a-zA-Z0-9]/.test(password)) {
            setError('Password must contain at least one special character');
            return;
        }

        setIsLoading(true);

        try {
            const result = await signUp({ name: name.trim(), email: normalizedEmail, password });

            if (!result.success) {
                setError(result.error || 'Failed to create account');
                return;
            }

            // Check if user became admin (first user)
            // const isAdmin = result.data?.role === 'admin';

            // Sign in after successful signup
            const signInResult = await signIn('credentials', {
                email,
                password,
                redirect: false,
            });

            if (signInResult?.error) {
                setError('Account created but failed to sign in. Please sign in manually.');
                router.push('/auth/signin');
            } else {
                router.push('/');
                router.refresh();
            }
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const header = (
        <div className="text-center pt-4">
            <div className="text-4xl mb-2">💰</div>
            <h2 className="text-2xl font-semibold text-gray-900">Create your account</h2>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <Card header={header} className="w-full max-w-md shadow-lg">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {error && (
                        <Message severity="error" text={error} className="w-full" />
                    )}

                    <div className="flex flex-col gap-2">
                        <label htmlFor="name" className="font-medium text-gray-700">
                            Name
                        </label>
                        <InputText
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="John Doe"
                            required
                            autoComplete="name"
                            maxLength={100}
                            className="w-full"
                        />
                    </div>

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
                            autoComplete="email"
                            className="w-full"
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
                            toggleMask
                            className="w-full"
                            inputClassName="w-full"
                            autoComplete="new-password"
                            promptLabel="Choose a strong password"
                            weakLabel="Weak - add more variety"
                            mediumLabel="Getting better"
                            strongLabel="Strong password!"
                        />
                        <div className="text-xs text-gray-500 space-y-1">
                            <p className="font-medium">Password requirements:</p>
                            <ul className="list-disc pl-4 space-y-0.5">
                                <li className={password.length >= 8 ? 'text-green-600' : ''}>At least 8 characters</li>
                                <li className={/[a-z]/.test(password) ? 'text-green-600' : ''}>One lowercase letter</li>
                                <li className={/[A-Z]/.test(password) ? 'text-green-600' : ''}>One uppercase letter</li>
                                <li className={/[0-9]/.test(password) ? 'text-green-600' : ''}>One number</li>
                                <li className={/[^a-zA-Z0-9]/.test(password) ? 'text-green-600' : ''}>One special character (!@#$%^&*...)</li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="confirmPassword" className="font-medium text-gray-700">
                            Confirm Password
                        </label>
                        <Password
                            id="confirmPassword"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            feedback={false}
                            toggleMask
                            className="w-full"
                            inputClassName="w-full"
                            autoComplete="new-password"
                        />
                        {confirmPassword && password !== confirmPassword && (
                            <small className="text-red-500">Passwords do not match</small>
                        )}
                    </div>

                    <Button
                        type="submit"
                        label="Create Account"
                        icon={isLoading ? 'pi pi-spin pi-spinner' : 'pi pi-user-plus'}
                        loading={isLoading}
                        className="w-full mt-2"
                    />
                </form>

                <p className="mt-6 text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link href="/auth/signin" className="text-blue-600 hover:underline font-medium">
                        Sign in
                    </Link>
                </p>
            </Card>
        </div>
    );
}
