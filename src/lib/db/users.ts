import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import type { User, UserRole, PublicUser } from '@/types';
import {
  getDataDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
  getUserDir,
} from './encryption';

const USERS_INDEX_FILE = 'users-index.enc';

interface UsersIndex {
  users: { id: string; email: string }[];
}

async function getUsersIndexPath(): Promise<string> {
  const dataDir = getDataDir();
  await ensureDir(dataDir);
  return path.join(dataDir, USERS_INDEX_FILE);
}

async function getUsersIndex(): Promise<UsersIndex> {
  const indexPath = await getUsersIndexPath();
  const index = await readEncryptedFile<UsersIndex>(indexPath);
  return index || { users: [] };
}

async function saveUsersIndex(index: UsersIndex): Promise<void> {
  const indexPath = await getUsersIndexPath();
  await writeEncryptedFile(indexPath, index);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const index = await getUsersIndex();
  const userEntry = index.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (!userEntry) {
    return null;
  }
  
  const userDir = getUserDir(userEntry.id);
  const userFile = path.join(userDir, 'user.enc');
  const user = await readEncryptedFile<User>(userFile);
  
  // Migration: add default values for new fields if missing
  if (user && !user.role) {
    user.role = 'user';
    user.isActive = true;
  }
  
  return user;
}

export async function findUserById(id: string): Promise<User | null> {
  const userDir = getUserDir(id);
  const userFile = path.join(userDir, 'user.enc');
  const user = await readEncryptedFile<User>(userFile);
  
  // Migration: add default values for new fields if missing
  if (user && !user.role) {
    user.role = 'user';
    user.isActive = true;
  }
  
  return user;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function createUser(
  email: string, 
  password: string, 
  name: string, 
  role: UserRole = 'user'
): Promise<User> {
  // Check if user already exists
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new Error('User with this email already exists');
  }
  
  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 12);
  
  // Check if this is the first user - make them admin
  const index = await getUsersIndex();
  const isFirstUser = index.users.length === 0;
  
  const user: User = {
    id,
    email: email.toLowerCase(),
    name,
    passwordHash,
    role: isFirstUser ? 'admin' : role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  
  // Create user directory and save user data
  const userDir = getUserDir(id);
  await ensureDir(userDir);
  
  const userFile = path.join(userDir, 'user.enc');
  await writeEncryptedFile(userFile, user);
  
  // Update users index
  index.users.push({ id, email: user.email });
  await saveUsersIndex(index);
  
  return user;
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function updateUser(
  userId: string, 
  updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'isActive'>>
): Promise<User | null> {
  const user = await findUserById(userId);
  if (!user) {
    return null;
  }
  
  const updatedUser: User = {
    ...user,
    ...updates,
    email: updates.email ? updates.email.toLowerCase() : user.email,
    updatedAt: new Date().toISOString(),
  };
  
  const userDir = getUserDir(userId);
  const userFile = path.join(userDir, 'user.enc');
  await writeEncryptedFile(userFile, updatedUser);
  
  // Update index if email changed
  if (updates.email && updates.email.toLowerCase() !== user.email.toLowerCase()) {
    const index = await getUsersIndex();
    const userEntry = index.users.find(u => u.id === userId);
    if (userEntry) {
      userEntry.email = updates.email.toLowerCase();
      await saveUsersIndex(index);
    }
  }
  
  return updatedUser;
}

export async function changePassword(userId: string, newPassword: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) {
    return false;
  }
  
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updatedUser: User = {
    ...user,
    passwordHash,
    updatedAt: new Date().toISOString(),
  };
  
  const userDir = getUserDir(userId);
  const userFile = path.join(userDir, 'user.enc');
  await writeEncryptedFile(userFile, updatedUser);
  
  return true;
}

export async function getAllUsers(): Promise<User[]> {
  const index = await getUsersIndex();
  const users: User[] = [];
  
  for (const entry of index.users) {
    const user = await findUserById(entry.id);
    if (user) {
      users.push(user);
    }
  }
  
  return users;
}

export async function deleteUser(userId: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) {
    return false;
  }
  
  // Remove from index
  const index = await getUsersIndex();
  index.users = index.users.filter(u => u.id !== userId);
  await saveUsersIndex(index);
  
  // Note: We don't delete the user directory to preserve data
  // Instead we just deactivate them
  const updatedUser: User = {
    ...user,
    isActive: false,
    updatedAt: new Date().toISOString(),
  };
  
  const userDir = getUserDir(userId);
  const userFile = path.join(userDir, 'user.enc');
  await writeEncryptedFile(userFile, updatedUser);
  
  return true;
}

export async function getAllUserIds(): Promise<string[]> {
  const index = await getUsersIndex();
  return index.users.map(u => u.id);
}
