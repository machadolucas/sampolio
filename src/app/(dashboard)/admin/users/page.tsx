'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Dropdown } from 'primereact/dropdown';
import { InputSwitch } from 'primereact/inputswitch';
import { Tag } from 'primereact/tag';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Toast } from 'primereact/toast';
import { useRef } from 'react';
import type { PublicUser, UserRole } from '@/types';

export default function AdminUsersPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const toast = useRef<Toast>(null);

    const [users, setUsers] = useState<PublicUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [dialogVisible, setDialogVisible] = useState(false);
    const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'user' as UserRole,
        isActive: true,
    });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (session?.user?.role !== 'admin') {
            router.push('/dashboard');
            return;
        }
        fetchUsers();
    }, [session, router]);

    const fetchUsers = async () => {
        try {
            setIsLoading(true);
            const res = await fetch('/api/admin/users');
            const data = await res.json();
            if (data.success) {
                setUsers(data.data);
            } else {
                setError(data.error || 'Failed to fetch users');
            }
        } catch {
            setError('Failed to fetch users');
        } finally {
            setIsLoading(false);
        }
    };

    const openNewDialog = () => {
        setEditingUser(null);
        setFormData({
            name: '',
            email: '',
            password: '',
            role: 'user',
            isActive: true,
        });
        setDialogVisible(true);
    };

    const openEditDialog = (user: PublicUser) => {
        setEditingUser(user);
        setFormData({
            name: user.name,
            email: user.email,
            password: '',
            role: user.role,
            isActive: user.isActive,
        });
        setDialogVisible(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (editingUser) {
                // Update user
                const updateData: Record<string, unknown> = {
                    name: formData.name,
                    email: formData.email,
                    role: formData.role,
                    isActive: formData.isActive,
                };
                if (formData.password) {
                    updateData.password = formData.password;
                }

                const res = await fetch(`/api/admin/users/${editingUser.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData),
                });
                const data = await res.json();

                if (data.success) {
                    toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User updated successfully' });
                    setDialogVisible(false);
                    fetchUsers();
                } else {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: data.error });
                }
            } else {
                // Create user
                if (!formData.password) {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: 'Password is required' });
                    setIsSaving(false);
                    return;
                }

                const res = await fetch('/api/admin/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });
                const data = await res.json();

                if (data.success) {
                    toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User created successfully' });
                    setDialogVisible(false);
                    fetchUsers();
                } else {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: data.error });
                }
            }
        } catch {
            toast.current?.show({ severity: 'error', summary: 'Error', detail: 'An error occurred' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = (user: PublicUser) => {
        confirmDialog({
            message: `Are you sure you want to delete ${user.name}?`,
            header: 'Confirm Delete',
            icon: 'pi pi-exclamation-triangle',
            acceptClassName: 'p-button-danger',
            accept: async () => {
                try {
                    const res = await fetch(`/api/admin/users/${user.id}`, {
                        method: 'DELETE',
                    });
                    const data = await res.json();

                    if (data.success) {
                        toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User deleted successfully' });
                        fetchUsers();
                    } else {
                        toast.current?.show({ severity: 'error', summary: 'Error', detail: data.error });
                    }
                } catch {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: 'Failed to delete user' });
                }
            },
        });
    };

    const roleBodyTemplate = (user: PublicUser) => {
        return (
            <Tag
                value={user.role}
                severity={user.role === 'admin' ? 'info' : 'secondary'}
            />
        );
    };

    const statusBodyTemplate = (user: PublicUser) => {
        return (
            <Tag
                value={user.isActive ? 'Active' : 'Inactive'}
                severity={user.isActive ? 'success' : 'danger'}
            />
        );
    };

    const actionsBodyTemplate = (user: PublicUser) => {
        const isCurrentUser = user.id === session?.user?.id;
        return (
            <div className="flex gap-2">
                <Button
                    icon="pi pi-pencil"
                    severity="secondary"
                    text
                    onClick={() => openEditDialog(user)}
                />
                <Button
                    icon="pi pi-trash"
                    severity="danger"
                    text
                    disabled={isCurrentUser}
                    onClick={() => handleDelete(user)}
                />
            </div>
        );
    };

    const roleOptions = [
        { label: 'User', value: 'user' },
        { label: 'Admin', value: 'admin' },
    ];

    if (session?.user?.role !== 'admin') {
        return null;
    }

    return (
        <>
            <Toast ref={toast} />
            <ConfirmDialog />

            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
                    <p className="text-gray-600 mt-1">Manage user accounts and permissions</p>
                </div>
                <Button
                    label="New User"
                    icon="pi pi-plus"
                    onClick={openNewDialog}
                />
            </div>

            {error && (
                <Message severity="error" text={error} className="w-full mb-4" />
            )}

            <Card>
                <DataTable
                    value={users}
                    loading={isLoading}
                    emptyMessage="No users found"
                    paginator
                    rows={10}
                    rowsPerPageOptions={[5, 10, 25, 50]}
                    stripedRows
                >
                    <Column field="name" header="Name" sortable />
                    <Column field="email" header="Email" sortable />
                    <Column field="role" header="Role" body={roleBodyTemplate} sortable />
                    <Column field="isActive" header="Status" body={statusBodyTemplate} sortable />
                    <Column field="createdAt" header="Created" sortable body={(user) => new Date(user.createdAt).toLocaleDateString()} />
                    <Column body={actionsBodyTemplate} header="Actions" style={{ width: '120px' }} />
                </DataTable>
            </Card>

            <Dialog
                visible={dialogVisible}
                onHide={() => setDialogVisible(false)}
                header={editingUser ? 'Edit User' : 'New User'}
                style={{ width: '450px' }}
                modal
            >
                <div className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-2">
                        <label htmlFor="name" className="font-medium">Name</label>
                        <InputText
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="email" className="font-medium">Email</label>
                        <InputText
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="password" className="font-medium">
                            {editingUser ? 'New Password (leave empty to keep current)' : 'Password'}
                        </label>
                        <Password
                            id="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="w-full"
                            inputClassName="w-full"
                            toggleMask
                            feedback={!editingUser}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="role" className="font-medium">Role</label>
                        <Dropdown
                            id="role"
                            value={formData.role}
                            options={roleOptions}
                            onChange={(e) => setFormData({ ...formData, role: e.value })}
                            className="w-full"
                            disabled={editingUser?.id === session?.user?.id}
                        />
                    </div>

                    {editingUser && (
                        <div className="flex items-center gap-3">
                            <InputSwitch
                                id="isActive"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.value })}
                                disabled={editingUser?.id === session?.user?.id}
                            />
                            <label htmlFor="isActive" className="font-medium">Active</label>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 mt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            onClick={() => setDialogVisible(false)}
                        />
                        <Button
                            label={editingUser ? 'Update' : 'Create'}
                            icon={isSaving ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
                            loading={isSaving}
                            onClick={handleSave}
                        />
                    </div>
                </div>
            </Dialog>
        </>
    );
}
