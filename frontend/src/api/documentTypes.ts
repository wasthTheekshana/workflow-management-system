import { apiFetch } from './client';

export type WorkflowMode = 'predefined' | 'adhoc';

export interface DocumentType {
  id: string;
  name: string;
  template_file_id: string;
  workflow_mode: WorkflowMode;
  workflow_template_id: string | null;
  allowed_extensions: string[];
  max_upload_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeInput {
  name: string;
  templateFileId: string;
  workflowMode?: WorkflowMode;
  workflowTemplateId?: string;
  allowedExtensions?: string[];
  maxUploadSizeBytes?: number;
}

export function listDocumentTypes(): Promise<DocumentType[]> {
  return apiFetch('/admin/document-types');
}

export function createDocumentType(input: DocumentTypeInput): Promise<DocumentType> {
  return apiFetch('/admin/document-types', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDocumentType(id: string, input: Partial<DocumentTypeInput>): Promise<DocumentType> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteDocumentType(id: string): Promise<void> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'DELETE' });
}
