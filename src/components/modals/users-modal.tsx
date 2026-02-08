'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Dialog } from 'primereact/dialog';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Dropdown } from 'primereact/dropdown';
import { InputSwitch } from 'primereact/inputswitch';
import { Tag } from 'primereact/tag';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Toast } from 'primereact/toast';
import { MdWarning, MdEdit, MdDelete, MdLock, MdAdd, MdCheck } from 'react-icons/md';
import {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
} from '@/lib/actions/admin';
import type { PublicUser, UserRole } from '@/types';

interface UsersModalProps {
    visible: boolean;
    onHide: () => void;
}

export function UsersModal({ visible, onHide }: UsersModalProps) {
    const { data: session } = useSession();
    const toast = useRef<Toast>(null);

    const [users, setUsers] = useState<PublicUser[]>([]);
    const [isLoading, setIsLoading] = useState(false);
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
        if (visible && session?.user?.role === 'admin') {
            fetchUsers();
        }
    }, [visible, session]);

    const fetchUsers = async () => {
        try {
            setIsLoading(true);
            const result = await getUsers();
            if (result.success && result.data) {
                setUsers(result.data);
            } else {
                setError(result.error || 'Failed to fetch users');
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
                const updateData: Record<string, unknown> = {
                    name: formData.name,
                    email: formData.email,
                    role: formData.role,
                    isActive: formData.isActive,
                };
                if (formData.password) {
                    updateData.password = formData.password;
                }

                const result = await updateUser(editingUser.id, updateData as Parameters<typeof updateUser>[1]);

                if (result.success) {
                    toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User updated successfully' });
                    setDialogVisible(false);
                    fetchUsers();
                } else {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: result.error });
                }
            } else {
                if (!formData.password) {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: 'Password is required' });
                    setIsSaving(false);
                    return;
                }

                const result = await createUser(formData);

                if (result.success) {
                    toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User created successfully' });
                    setDialogVisible(false);
                    fetchUsers();
                } else {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: result.error });
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
            icon: <MdWarning />,
            acceptClassName: 'p-button-danger',
            accept: async () => {
                try {
                    const result = await deleteUser(user.id);
                    if (result.success) {
                        toast.current?.show({ severity: 'success', summary: 'Success', detail: 'User deleted successfully' });
                        fetchUsers();
                    } else {
                        toast.current?.show({ severity: 'error', summary: 'Error', detail: result.error });
                    }
                } catch {
                    toast.current?.show({ severity: 'error', summary: 'Error', detail: 'Failed to delete user' });
                }
            },
        });
    };

    const roleBodyTemplate = (user: PublicUser) => (
        <Tag value={user.role} severity={user.role === 'admin' ? 'info' : 'secondary'} />
    );

    const statusBodyTemplate = (user: PublicUser) => (
        <Tag value={user.isActive ? 'Active' : 'Inactive'} severity={user.isActive ? 'success' : 'danger'} />
    );

    const actionsBodyTemplate = (user: PublicUser) => {
        const isCurrentUser = user.id === session?.user?.id;
        return (
            <div className="flex gap-2">
                <Button icon={<MdEdit />} severity="secondary" text onClick={() => openEditDialog(user)} />
                <Button icon={<MdDelete />} severity="danger" text disabled={isCurrentUser} onClick={() => handleDelete(user)} />
            </div>
        );
    };

    const roleOptions = [
        { label: 'User', value: 'user' },
        { label: 'Admin', value: 'admin' },
    ];

    const isAdmin = session?.user?.role === 'admin';

    return (
        <Dialog
            header="User Management"
            visible={visible}
            onHide={onHide}
            style={{ width: '95vw', maxWidth: '1200px' }}
            maximizable
            modal
            dismissableMask
        >
            <Toast ref={toast} />
            <ConfirmDialog />

            {!isAdmin ? (
                <div className="text-center py-8">
                    <MdLock size={36} className="text-gray-400 mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">Admin access required</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-gray-600 dark:text-gray-400">Manage user accounts and permissions</p>
                        <Button label="New User" icon={<MdAdd />} onClick={openNewDialog} />
                    </div>

                    {error && <Message severity="error" text={error} className="w-full" />}

                    <Card>
                        <DataTable
                            value={users}
                            loading={isLoading}
                            emptyMessage="No users found"
                            paginator
                            rows={10}
                            rowsPerPageOptions={[5, 10, 25]}
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
                </div>
            )}

            {/* Edit/Create Dialog */}
            <Dialog
                visible={dialogVisible}
                onHide={() => setDialogVisible(false)}
                header={editingUser ? 'Edit User' : 'New User'}
                style={{ width: '450px' }}
                modal
            >
                <div className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-2">
                        <label className="font-medium">Name</label>
                        <InputText value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-medium">Email</label>
                        <InputText type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-medium">{editingUser ? 'New Password (leave empty to keep)' : 'Password'}</label>
                        <Password value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="w-full" inputClassName="w-full" toggleMask feedback={!editingUser} />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="font-medium">Role</label>
                        <Dropdown value={formData.role} options={roleOptions} onChange={(e) => setFormData({ ...formData, role: e.value })} className="w-full" disabled={editingUser?.id === session?.user?.id} />
                    </div>
                    {editingUser && (
                        <div className="flex items-center gap-3">
                            <InputSwitch checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.value })} disabled={editingUser?.id === session?.user?.id} />
                            <label className="font-medium">Active</label>
                        </div>
                    )}
                    <div className="flex justify-end gap-2 mt-4">
                        <Button label="Cancel" severity="secondary" onClick={() => setDialogVisible(false)} />
                        <Button label={editingUser ? 'Update' : 'Create'} icon={<MdCheck />} loading={isSaving} onClick={handleSave} />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
