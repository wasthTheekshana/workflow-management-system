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

export interface VisibleUser {
  id: string;
  email: string;
  full_name: string | null;
}

export function listVisibleUsers(): Promise<VisibleUser[]> {
  return apiFetch('/users/visible');
}
