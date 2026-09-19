import { apiFetch, apiFetchBlob } from './client';

export interface InstanceAttachment {
  id: string;
  tenant_id: string;
  workflow_instance_id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string | null;
  uploaded_by: string;
  uploader_name?: string | null;
  uploader_email?: string | null;
  created_at: string;
}

export async function listAttachments(instanceId: string): Promise<InstanceAttachment[]> {
  return apiFetch<InstanceAttachment[]>(`/instances/${instanceId}/attachments`);
}

export async function uploadAttachment(instanceId: string, file: File): Promise<InstanceAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<InstanceAttachment>(`/instances/${instanceId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}

export async function downloadAttachment(instanceId: string, attachmentId: string, fileName: string): Promise<void> {
  const blob = await apiFetchBlob(`/instances/${instanceId}/attachments/${attachmentId}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteAttachment(instanceId: string, attachmentId: string): Promise<void> {
  return apiFetch<void>(`/instances/${instanceId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}

