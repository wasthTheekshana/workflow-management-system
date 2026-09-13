import { apiFetch } from './client';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
}

export function listUsers(): Promise<AdminUser[]> {
  return apiFetch('/admin/users');
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName?: string;
  isAdmin?: boolean;
}

export function createUser(input: CreateUserInput): Promise<AdminUser> {
  return apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(input) });
}

export interface VisibleUser {
  id: string;
  email: string;
  full_name: string | null;
}

export function listVisibleUsers(): Promise<VisibleUser[]> {
  return apiFetch('/users/visible');
}
