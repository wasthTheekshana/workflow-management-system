import { apiFetch } from './client';

export interface AdminRole {
  id: string;
  name: string;
}

export function listRoles(): Promise<AdminRole[]> {
  return apiFetch('/admin/roles');
}
