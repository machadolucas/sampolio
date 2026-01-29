'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from 'primereact/card';
import { InputSwitch } from 'primereact/inputswitch';
import { Message } from 'primereact/message';
import { Toast } from 'primereact/toast';
import { Divider } from 'primereact/divider';
import type { AppSettings } from '@/types';

export default function AdminSettingsPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const toast = useRef<Toast>(null);

    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (session?.user?.role !== 'admin') {
            router.push('/dashboard');
            return;
        }
        fetchSettings();
    }, [session, router]);

    const fetchSettings = async () => {
        try {
            setIsLoading(true);
            const res = await fetch('/api/admin/settings');
            const data = await res.json();
            if (data.success) {
                setSettings(data.data);
            } else {
                setError(data.error || 'Failed to fetch settings');
            }
        } catch {
            setError('Failed to fetch settings');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleSelfSignup = async (value: boolean) => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selfSignupEnabled: value }),
            });
            const data = await res.json();

            if (data.success) {
                setSettings(data.data);
                toast.current?.show({
                    severity: 'success',
                    summary: 'Success',
                    detail: `Self-signup ${value ? 'enabled' : 'disabled'}`,
                });
            } else {
                toast.current?.show({
                    severity: 'error',
                    summary: 'Error',
                    detail: data.error,
                });
            }
        } catch {
            toast.current?.show({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to update settings',
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (session?.user?.role !== 'admin') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <i className="pi pi-spin pi-spinner text-4xl text-blue-600"></i>
            </div>
        );
    }

    return (
        <>
            <Toast ref={toast} />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Application Settings</h1>
                <p className="text-gray-600 mt-1">Configure application-wide settings</p>
            </div>

            {error && (
                <Message severity="error" text={error} className="w-full mb-4" />
            )}

            <Card title="User Registration">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-gray-900">Self-Signup</h3>
                            <p className="text-sm text-gray-600 mt-1">
                                Allow new users to create accounts without admin approval
                            </p>
                        </div>
                        <InputSwitch
                            checked={settings?.selfSignupEnabled || false}
                            onChange={(e) => handleToggleSelfSignup(e.value)}
                            disabled={isSaving}
                        />
                    </div>

                    {settings && !settings.selfSignupEnabled && (
                        <Message
                            severity="warn"
                            text="Self-signup is disabled. Only admins can create new user accounts."
                            className="w-full"
                        />
                    )}
                </div>
            </Card>

            <Divider />

            <Card title="About">
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between">
                        <span className="text-gray-600">Application</span>
                        <span className="font-medium">Sampolio</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-600">Version</span>
                        <span className="font-medium">1.0.0</span>
                    </div>
                    {settings && (
                        <>
                            <Divider className="my-2" />
                            <div className="flex justify-between">
                                <span className="text-gray-600">Settings last updated</span>
                                <span className="font-medium">
                                    {new Date(settings.updatedAt).toLocaleString()}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </Card>
        </>
    );
}
