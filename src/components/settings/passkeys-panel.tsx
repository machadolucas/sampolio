'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { confirmDialog } from 'primereact/confirmdialog';
import { MdAdd, MdDelete, MdEdit, MdFingerprint, MdLogin } from 'react-icons/md';
import { authClient } from '@/lib/auth-client';
import { ACCOUNT_SETTINGS_PATH, PASSKEY_REAUTH_REQUIRED } from '@/lib/auth/constants';
import { listMyPasskeys } from '@/lib/actions/account';
import { useToast } from '@/components/providers/toast-provider';
import { LOCALE } from '@/lib/constants';
import type { PasskeySummary } from '@/types';

interface PasskeysPanelProps {
    isDark: boolean;
}

const CANCELLED_CODES = new Set(['ERROR_CEREMONY_ABORTED', 'AUTH_CANCELLED', 'REGISTRATION_CANCELLED']);

const noopSubscribe = () => () => {};

function formatDate(iso?: string): string {
    return iso ? new Date(iso).toLocaleDateString(LOCALE) : '—';
}

/**
 * Settings › Account › Passkeys. Passkeys sit alongside the password (never
 * replace it). Add/rename/delete go through the Better Auth passkey client;
 * the list comes from the `listMyPasskeys` server action (adds last-used).
 */
export function PasskeysPanel({ isDark }: PasskeysPanelProps) {
    const toast = useToast();
    const router = useRouter();
    const [needsReauth, setNeedsReauth] = useState(false);
    const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [renaming, setRenaming] = useState<PasskeySummary | null>(null);
    const [newName, setNewName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    // WebAuthn support never changes at runtime; `true` on the server keeps
    // hydration stable.
    const supported = useSyncExternalStore(
        noopSubscribe,
        () => typeof window.PublicKeyCredential !== 'undefined',
        () => true,
    );

    const subtext = `text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`;

    const load = useCallback(async () => {
        const result = await listMyPasskeys();
        if (result.success && result.data) setPasskeys(result.data);
        else setPasskeys([]);
    }, []);

    useEffect(() => {
        let cancelled = false;
        listMyPasskeys().then((result) => {
            if (!cancelled) setPasskeys(result.success && result.data ? result.data : []);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleAdd = async () => {
        setIsAdding(true);
        try {
            const result = await authClient.passkey.addPasskey();
            const err = result?.error as { code?: string; message?: string } | null | undefined;
            if (err) {
                if (err.code === PASSKEY_REAUTH_REQUIRED) {
                    // Registration needs a recent sign-in (src/lib/auth/constants.ts).
                    setNeedsReauth(true);
                    return;
                }
                if (!err.code || !CANCELLED_CODES.has(err.code)) {
                    toast.error('Could not add passkey', err.message);
                }
                return;
            }
            setNeedsReauth(false);
            toast.success('Passkey added', 'You can now sign in with it on this device.');
            await load();
        } finally {
            setIsAdding(false);
        }
    };

    const handleSignInAgain = async () => {
        await authClient.signOut();
        router.push(`/auth/signin?callbackUrl=${encodeURIComponent(ACCOUNT_SETTINGS_PATH)}`);
    };

    const openRename = (pk: PasskeySummary) => {
        setRenaming(pk);
        setNewName(pk.name);
    };

    const handleRename = async () => {
        if (!renaming) return;
        const name = newName.trim();
        if (!name) return;
        setIsSavingName(true);
        try {
            const { error } = await authClient.passkey.updatePasskey({ id: renaming.id, name });
            if (error) {
                toast.error('Could not rename passkey', error.message);
                return;
            }
            toast.success('Passkey renamed');
            setRenaming(null);
            await load();
        } finally {
            setIsSavingName(false);
        }
    };

    const handleDelete = (pk: PasskeySummary) => {
        confirmDialog({
            header: 'Delete passkey?',
            icon: 'pi pi-exclamation-triangle',
            acceptClassName: 'p-button-danger',
            acceptLabel: 'Delete',
            message: `"${pk.name}" will no longer sign you in. Your password keeps working.`,
            accept: async () => {
                const { error } = await authClient.passkey.deletePasskey({ id: pk.id });
                if (error) {
                    toast.error('Could not delete passkey', error.message);
                    return;
                }
                toast.success('Passkey deleted');
                await load();
            },
        });
    };

    return (
        <Card>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>Passkeys</h2>
                    <p className={subtext}>
                        Sign in with Face ID, Touch ID or your password manager instead of typing your password.
                        Your password keeps working.
                    </p>
                </div>
                <Button
                    label="Add passkey"
                    icon={<MdAdd />}
                    onClick={handleAdd}
                    loading={isAdding}
                    disabled={!supported}
                    className="w-full sm:w-auto shrink-0"
                />
            </div>

            {!supported && <p className={subtext}>This browser does not support passkeys.</p>}

            {needsReauth && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4" role="alert">
                    <Message severity="warn" text="For security, sign in again to add a passkey." className="w-full sm:flex-1" />
                    <Button
                        label="Sign in again"
                        icon={<MdLogin />}
                        outlined
                        onClick={handleSignInAgain}
                        className="w-full sm:w-auto shrink-0"
                    />
                </div>
            )}

            {passkeys === null ? (
                <p className={subtext}>Loading…</p>
            ) : passkeys.length === 0 ? (
                <p className={subtext}>No passkeys yet.</p>
            ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label="Your passkeys">
                    {passkeys.map((pk) => (
                        <li key={pk.id} className="flex items-center gap-3 py-3">
                            <MdFingerprint size={24} className="shrink-0 text-accent-600" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <p className={`font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                    {pk.name}
                                    {pk.backedUp && <Tag value="Synced" severity="info" className="ml-2 align-middle text-xs" />}
                                </p>
                                <p className={`${subtext} truncate`}>
                                    Added {formatDate(pk.createdAt)} · Last used {formatDate(pk.lastUsedAt)}
                                </p>
                            </div>
                            <Button
                                icon={<MdEdit />}
                                text
                                severity="secondary"
                                aria-label={`Rename ${pk.name}`}
                                onClick={() => openRename(pk)}
                                className="min-w-11 min-h-11"
                            />
                            <Button
                                icon={<MdDelete />}
                                text
                                severity="danger"
                                aria-label={`Delete ${pk.name}`}
                                onClick={() => handleDelete(pk)}
                                className="min-w-11 min-h-11"
                            />
                        </li>
                    ))}
                </ul>
            )}

            <Dialog
                header="Rename passkey"
                visible={!!renaming}
                onHide={() => setRenaming(null)}
                style={{ width: '26rem', maxWidth: '95vw' }}
                modal
                draggable={false}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button label="Cancel" severity="secondary" text onClick={() => setRenaming(null)} disabled={isSavingName} />
                        <Button label="Save" onClick={handleRename} loading={isSavingName} disabled={!newName.trim()} />
                    </div>
                }
            >
                <label htmlFor="passkey-name" className={`block text-sm mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Name
                </label>
                <InputText
                    id="passkey-name"
                    value={newName}
                    maxLength={60}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename();
                    }}
                    className="w-full"
                    autoFocus
                />
            </Dialog>
        </Card>
    );
}
