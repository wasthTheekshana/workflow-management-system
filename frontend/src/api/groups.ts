import { apiFetch } from './client';

export interface AdminGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface GroupMember {
  id: string;
  email: string;
  full_name: string | null;
  level: number;
}

export interface AdminGroupDetail extends AdminGroup {
  members: GroupMember[];
}

export function listGroups(): Promise<AdminGroup[]> {
  return apiFetch('/admin/groups');
}

export function getGroup(id: string): Promise<AdminGroupDetail> {
  return apiFetch(`/admin/groups/${id}`);
}

export function createGroup(name: string): Promise<AdminGroup> {
  return apiFetch('/admin/groups', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameGroup(id: string, name: string): Promise<AdminGroup> {
  return apiFetch(`/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export function deleteGroup(id: string): Promise<void> {
  return apiFetch(`/admin/groups/${id}`, { method: 'DELETE' });
}

export function addGroupMember(id: string, userId: string, level = 1): Promise<void> {
  return apiFetch(`/admin/groups/${id}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, level }),
  });
}

export function updateGroupMemberLevel(id: string, userId: string, level: number): Promise<void> {
  return apiFetch(`/admin/groups/${id}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ level }),
  });
}

export function removeGroupMember(id: string, userId: string): Promise<void> {
  return apiFetch(`/admin/groups/${id}/members/${userId}`, { method: 'DELETE' });
}

export interface VisibleGroup {
  id: string;
  name: string;
}

export function listVisibleGroups(): Promise<VisibleGroup[]> {
  return apiFetch('/groups/visible');
}
