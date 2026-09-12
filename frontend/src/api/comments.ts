import { apiFetch } from './client';

export interface InstanceComment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export function listComments(instanceId: string): Promise<InstanceComment[]> {
  return apiFetch(`/instances/${instanceId}/comments`);
}

export function addComment(instanceId: string, body: string): Promise<InstanceComment> {
  return apiFetch(`/instances/${instanceId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}
