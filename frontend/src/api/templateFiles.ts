import { apiFetch } from './client';

export interface TemplateFile {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateFileVersion {
  id: string;
  template_file_id: string;
  version_number: number;
  file_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface TemplateFileDetail extends TemplateFile {
  versions: TemplateFileVersion[];
}

export function listTemplateFiles(): Promise<TemplateFile[]> {
  return apiFetch('/admin/template-files');
}

export function getTemplateFile(id: string): Promise<TemplateFileDetail> {
  return apiFetch(`/admin/template-files/${id}`);
}

export function createTemplateFile(name: string): Promise<TemplateFile> {
  return apiFetch('/admin/template-files', { method: 'POST', body: JSON.stringify({ name }) });
}

export function uploadTemplateFileVersion(id: string, file: File): Promise<TemplateFileVersion> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/admin/template-files/${id}/versions`, { method: 'POST', body: formData });
}
