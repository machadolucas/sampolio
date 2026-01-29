'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Dialog } from 'primereact/dialog';
import { Card } from 'primereact/card';
import { InputSwitch } from 'primereact/inputswitch';
import { Message } from 'primereact/message';
import { Toast } from 'primereact/toast';
import { Divider } from 'primereact/divider';
import { ProgressSpinner } from 'primereact/progressspinner';
import type { AppSettings } from '@/types';

interface SettingsModalProps {
    visible: boolean;
    onHide: () => void;
}

export function SettingsModal({ visible, onHide }: SettingsModalProps) {
    const { data: session } = useSession();
    const toast = useRef<Toast>(null);

    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (visible && session?.user?.role === 'admin') {
            fetchSettings();
        }
    }, [visible, session]);

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

    if (session?.user?.role !== 'admin') return null;

    return (
        <Dialog
            header="Application Settings"
            visible={visible}
            onHide={onHide}
            style={{ width: '95vw', maxWidth: '700px' }}
            modal
        >
            <Toast ref={toast} />

            {isLoading ? (
                <div className="flex items-center justify-center h-32">
                    <ProgressSpinner style={{ width: '40px', height: '40px' }} />
                </div>
            ) : (
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <Card title="User Registration">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-medium text-gray-900 dark:text-gray-100">Self-Signup</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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
                                <span className="text-gray-600 dark:text-gray-400">Application</span>
                                <span className="font-medium">Sampolio</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Version</span>
                                <span className="font-medium">1.0.0</span>
                            </div>
                            {settings && (
                                <>
                                    <Divider className="my-2" />
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">Settings last updated</span>
                                        <span className="font-medium">{new Date(settings.updatedAt).toLocaleString()}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </Dialog>
    );
}
