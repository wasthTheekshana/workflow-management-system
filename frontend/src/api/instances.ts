import { apiFetch, apiFetchBlob } from './client';
import type { ContentFormat } from './templateFiles';

export interface WorkflowInstance {
  id: string;
  ticket_number: number;
  document_type_id: string;
  workflow_template_id: string;
  template_file_version_id: string;
  current_stage_order: number;
  status: 'in_progress' | 'completed' | 'rejected' | 'cancelled';
  claimed_by: string | null;
  created_by: string;
  stage_entered_at?: string | null;
  stage_due_at?: string | null;
  is_overdue?: boolean;
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
  assignee_group_level?: number | null;
  allowed_actions: string[];
  sla_hours?: number | null;
  consensus_type?: 'single' | 'all' | 'any';
}

export interface StageApprovalRecord {
  id: string;
  user_id: string;
  user_email: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  created_at: string;
}

export interface EligibleApproverStatus {
  id: string;
  email: string;
  level?: number | null;
  hasApproved: boolean;
  decision: 'approved' | 'rejected' | null;
  comment: string | null;
  approvedAt: string | null;
}

export interface StageApprovalsSummary {
  stageOrder: number;
  stageName: string;
  consensusType: 'single' | 'all' | 'any';
  totalRequired: number;
  approvedCount: number;
  consensusReached: boolean;
  approvals: StageApprovalRecord[];
  eligibleApprovers: EligibleApproverStatus[];
}

export interface InstanceWithStage extends WorkflowInstance {
  currentStage: StageInfo;
  contentFormat: ContentFormat;
  workflowStages?: StageInfo[];
  stageApprovals?: StageApprovalsSummary;
}

export interface TaskListItem extends WorkflowInstance {
  document_type_name: string;
  currentStage?: StageInfo;
  has_approved?: boolean;
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
  file_path: string | null;
  content: unknown | null;
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
  workflowStages?: StageInfo[];
  versions: InstanceVersion[];
  auditLog: StageAction[];
}

export interface StartableDocumentType {
  id: string;
  name: string;
  workflow_mode: 'predefined' | 'adhoc';
}

export interface AdhocStageInput {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
  assigneeGroupLevel?: number | null;
  slaHours?: number | null;
}

export function getMyTasks(): Promise<MyTasksResponse> {
  return apiFetch('/instances/my-tasks');
}

export function listStartableDocumentTypes(): Promise<StartableDocumentType[]> {
  return apiFetch('/document-types');
}

export function startInstance(documentTypeId: string, stages?: AdhocStageInput[]): Promise<WorkflowInstance> {
  return apiFetch('/instances', { method: 'POST', body: JSON.stringify({ documentTypeId, stages }) });
}

export function startInstanceFromOwnDocument(input: {
  name: string;
  contentFormat: 'docx' | 'richtext';
  file?: File;
  content?: unknown;
  stages: AdhocStageInput[];
}): Promise<WorkflowInstance> {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('contentFormat', input.contentFormat);
  if (input.file) {
    formData.append('file', input.file);
  }
  if (input.content !== undefined) {
    formData.append('content', JSON.stringify(input.content));
  }
  formData.append('stages', JSON.stringify(input.stages));
  return apiFetch('/instances/from-document', { method: 'POST', body: formData });
}

export function getInstance(id: string): Promise<InstanceWithStage> {
  return apiFetch(`/instances/${id}`);
}

export function claimInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/claim`, { method: 'POST' });
}

export function unclaimInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/unclaim`, { method: 'POST' });
}

export function uploadInstanceVersion(id: string, file: File): Promise<InstanceVersion> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/instances/${id}/versions`, { method: 'POST', body: formData });
}

export function downloadCurrentFile(id: string): Promise<Blob> {
  return apiFetchBlob(`/instances/${id}/current-file`);
}

export function addInstanceContentVersion(id: string, content: unknown): Promise<InstanceVersion> {
  return apiFetch(`/instances/${id}/content-versions`, { method: 'POST', body: JSON.stringify({ content }) });
}

export function getCurrentContent(id: string): Promise<{ content: unknown }> {
  return apiFetch(`/instances/${id}/current-content`);
}

export function forwardInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/forward`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function sendBackInstance(
  id: string,
  comment?: string,
  targetStageOrder?: number,
): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/send-back`, {
    method: 'POST',
    body: JSON.stringify({ comment, targetStageOrder }),
  });
}

export function rejectInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function resubmitInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/resubmit`, { method: 'POST' });
}

export function cancelInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/cancel`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function getInstanceHistory(id: string): Promise<InstanceHistory> {
  return apiFetch(`/instances/${id}/history`);
}

export interface AdminInstanceListItem extends WorkflowInstance {
  document_type_name: string;
  creator_email: string | null;
  creator_name: string | null;
  claimant_email: string | null;
  claimant_name: string | null;
  currentStage: StageInfo | null;
}

export function listAdminInstances(params?: {
  status?: string;
  documentTypeId?: string;
  isOverdue?: boolean | string;
}): Promise<AdminInstanceListItem[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.append('status', params.status);
  if (params?.documentTypeId) searchParams.append('documentTypeId', params.documentTypeId);
  if (params?.isOverdue !== undefined) searchParams.append('isOverdue', String(params.isOverdue));
  const qs = searchParams.toString();
  return apiFetch(`/admin/instances${qs ? `?${qs}` : ''}`);
}

export function reassignInstance(id: string, userId: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/admin/instances/${id}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ userId, comment }),
  });
}

export function getStageApprovals(instanceId: string, stageOrder?: number): Promise<StageApprovalsSummary> {
  const query = stageOrder !== undefined ? `?stageOrder=${stageOrder}` : '';
  return apiFetch(`/instances/${instanceId}/stage-approvals${query}`);
}


