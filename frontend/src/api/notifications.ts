import { apiFetch } from './client';

export interface InAppNotification {
  id: string;
  tenant_id: string;
  workflow_instance_id: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  ticket_number: number | null;
  document_type_name: string | null;
}

export function listNotifications(params?: {
  unreadOnly?: boolean;
  limit?: number;
}): Promise<InAppNotification[]> {
  const searchParams = new URLSearchParams();
  if (params?.unreadOnly) searchParams.append('unreadOnly', 'true');
  if (params?.limit) searchParams.append('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`);
}

export function getUnreadNotificationCount(): Promise<{ unreadCount: number }> {
  return apiFetch('/notifications/unread-count');
}

export function markNotificationAsRead(id: string): Promise<InAppNotification> {
  return apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllNotificationsAsRead(): Promise<{ success: boolean; count: number }> {
  return apiFetch('/notifications/mark-all-read', { method: 'POST' });
}

