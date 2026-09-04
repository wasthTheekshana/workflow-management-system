import { apiFetch, apiFetchBlob } from './client';

export interface WorkflowInstance {
  id: string;
  ticket_number: number;
  document_type_id: string;
  template_file_version_id: string;
  current_stage_order: number;
  status: 'in_progress' | 'completed' | 'rejected';
  claimed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StageInfo {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role' | 'group';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  assignee_group_id: string | null;
  allowed_actions: string[];
}

export interface InstanceWithStage extends WorkflowInstance {
  currentStage: StageInfo;
}

export interface TaskListItem extends WorkflowInstance {
  document_type_name: string;
  currentStage?: StageInfo;
}

export interface MyTasksResponse {
  assignedToMe: TaskListItem[];
  waitingOnOthers: TaskListItem[];
  completed: TaskListItem[];
}

export interface InstanceVersion {
  id: string;
  workflow_instance_id: string;
  version_number: number;
  file_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface StageAction {
  id: string;
  workflow_instance_id: string;
  action_type: string;
  from_stage_order: number | null;
  to_stage_order: number | null;
  actor_id: string;
  comment: string | null;
  created_at: string;
}

export interface InstanceHistory {
  instance: WorkflowInstance;
  documentType: { id: string; name: string };
  currentStage: StageInfo;
  versions: InstanceVersion[];
  auditLog: StageAction[];
}

export interface StartableDocumentType {
  id: string;
  name: string;
}

export function getMyTasks(): Promise<MyTasksResponse> {
  return apiFetch('/instances/my-tasks');
}

export function listStartableDocumentTypes(): Promise<StartableDocumentType[]> {
  return apiFetch('/document-types');
}

export function startInstance(documentTypeId: string): Promise<WorkflowInstance> {
  return apiFetch('/instances', { method: 'POST', body: JSON.stringify({ documentTypeId }) });
}

export function getInstance(id: string): Promise<InstanceWithStage> {
  return apiFetch(`/instances/${id}`);
}

export function claimInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/claim`, { method: 'POST' });
}

export function uploadInstanceVersion(id: string, file: File): Promise<InstanceVersion> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/instances/${id}/versions`, { method: 'POST', body: formData });
}

export function downloadCurrentFile(id: string): Promise<Blob> {
  return apiFetchBlob(`/instances/${id}/current-file`);
}

export function forwardInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/forward`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function sendBackInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/send-back`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function rejectInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function resubmitInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/resubmit`, { method: 'POST' });
}

export function getInstanceHistory(id: string): Promise<InstanceHistory> {
  return apiFetch(`/instances/${id}/history`);
}
