'use client';

import { useState, useEffect, useId } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { InputText } from '@/components/ui/input-text';
import { Password } from '@/components/ui/password';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Message } from '@/components/ui/message';
import { BrandLogo } from '@/components/layout/brand-logo';
import { MdPersonAdd } from 'react-icons/md';
import { signUp, checkSignupEnabled } from '@/lib/actions/auth';
import { signUpSchema, type SignUpFormData } from '@/lib/schemas/auth.schema';

export default function SignUpPage() {
  const uid = useId();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if this might be the first user (for messaging purposes)
    checkSignupEnabled().catch(() => {}); // Ignore errors
  }, []);

  const onSubmit = async (data: SignUpFormData) => {
    setError('');
    setIsLoading(true);

    // Normalize email
    const normalizedEmail = data.email.toLowerCase().trim();

    try {
      const result = await signUp({
        name: data.name.trim(),
        email: normalizedEmail,
        password: data.password,
      });

      if (!result.success) {
        setError(result.error || 'Failed to create account');
        return;
      }

      // The sign-up action already signed the new user in (session
      // cookie set server-side by Better Auth's nextCookies plugin), so
      // go straight to Home.
      router.replace('/');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const header = (
    <div data-slot="auth-header" className="auth-brand-header glass-chrome text-center">
      <BrandLogo size={56} className="mx-auto mb-3" />
      <h1 className="text-2xl font-semibold text-foreground">
        Create your account
      </h1>
    </div>
  );

  return (
    <div className="auth-shell min-h-dvh flex items-center justify-center px-4 py-8">
      <Card header={header} className="auth-card w-full max-w-md">
        <div data-slot="auth-body" className="auth-form-body">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {error && (
            <Message severity="error" text={error} className="w-full" />
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${uid}-name`}
              className="font-medium text-foreground"
            >
              Name
            </label>
            <InputText
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? `${uid}-name-error` : undefined}
              id={`${uid}-name`}
              type="text"
              {...register('name')}
              placeholder="John Doe"
              autoComplete="name"
              maxLength={100}
              className="w-full"
            />
            {errors.name && (
              <small
                id={`${uid}-name-error`}
                role="alert"
                className="text-destructive"
              >
                {errors.name.message}
              </small>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${uid}-email`}
              className="font-medium text-foreground"
            >
              Email
            </label>
            <InputText
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? `${uid}-email-error` : undefined}
              id={`${uid}-email`}
              type="email"
              {...register('email')}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full"
            />
            {errors.email && (
              <small
                id={`${uid}-email-error`}
                role="alert"
                className="text-destructive"
              >
                {errors.email.message}
              </small>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${uid}-password`}
              className="font-medium text-foreground"
            >
              Password
            </label>
            <Controller
              name="password"
              control={control}
              render={({ field }) => (
                <Password
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? `${uid}-password-error` : undefined
                  }
                  inputId={`${uid}-password`}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  placeholder="••••••••"
                  toggleMask
                  className="w-full"
                  inputClassName="w-full"
                  autoComplete="new-password"
                  promptLabel="Choose a strong password"
                  weakLabel="Weak - add more variety"
                  mediumLabel="Getting better"
                  strongLabel="Strong password!"
                />
              )}
            />
            {errors.password && (
              <small
                id={`${uid}-password-error`}
                role="alert"
                className="text-destructive"
              >
                {errors.password.message}
              </small>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Password requirements:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li className={password.length >= 8 ? 'text-green-600' : ''}>
                  At least 8 characters
                </li>
                <li className={/[a-z]/.test(password) ? 'text-green-600' : ''}>
                  One lowercase letter
                </li>
                <li className={/[A-Z]/.test(password) ? 'text-green-600' : ''}>
                  One uppercase letter
                </li>
                <li className={/[0-9]/.test(password) ? 'text-green-600' : ''}>
                  One number
                </li>
                <li
                  className={
                    /[^a-zA-Z0-9]/.test(password) ? 'text-green-600' : ''
                  }
                >
                  One special character (!@#$%^&*...)
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${uid}-confirmPassword`}
              className="font-medium text-foreground"
            >
              Confirm Password
            </label>
            <Controller
              name="confirmPassword"
              control={control}
              render={({ field }) => (
                <Password
                  aria-invalid={!!errors.confirmPassword}
                  aria-describedby={
                    errors.confirmPassword
                      ? `${uid}-confirmPassword-error`
                      : undefined
                  }
                  inputId={`${uid}-confirmPassword`}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  placeholder="••••••••"
                  feedback={false}
                  toggleMask
                  className="w-full"
                  inputClassName="w-full"
                  autoComplete="new-password"
                />
              )}
            />
            {errors.confirmPassword && (
              <small
                id={`${uid}-confirmPassword-error`}
                role="alert"
                className="text-destructive"
              >
                {errors.confirmPassword.message}
              </small>
            )}
            {confirmPassword &&
              password !== confirmPassword &&
              !errors.confirmPassword && (
                <small className="text-destructive">
                  Passwords do not match
                </small>
              )}
          </div>

          <Button
            type="submit"
            label="Create Account"
            icon={<MdPersonAdd />}
            loading={isLoading}
            className="w-full mt-2"
          />
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/auth/signin"
            className="text-primary hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
        </div>
      </Card>
    </div>
  );
}
