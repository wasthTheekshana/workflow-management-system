import { apiFetch } from './client';

export interface OnlyOfficeDocumentConfig {
  fileType: string;
  key: string;
  title: string;
  url: string;
}

export interface OnlyOfficeEditorConfig {
  mode: 'edit' | 'view';
  callbackUrl?: string;
  user: { id: string; name: string };
}

export interface OnlyOfficeConfig {
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfig;
  token: string;
}

export function getTemplateEditConfig(templateFileId: string): Promise<OnlyOfficeConfig> {
  return apiFetch(`/admin/template-files/${templateFileId}/edit-config`);
}

export function getInstanceEditConfig(instanceId: string): Promise<OnlyOfficeConfig> {
  return apiFetch(`/instances/${instanceId}/edit-config`);
}
