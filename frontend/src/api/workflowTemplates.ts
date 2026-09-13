import { apiFetch } from './client';

export interface WorkflowTemplate {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStage {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role' | 'group';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  assignee_group_id: string | null;
  allowed_actions: string[];
  created_at: string;
}

export interface WorkflowTemplateDetail extends WorkflowTemplate {
  stages: WorkflowStage[];
}

export function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return apiFetch('/admin/workflow-templates');
}

export function getWorkflowTemplate(id: string): Promise<WorkflowTemplateDetail> {
  return apiFetch(`/admin/workflow-templates/${id}`);
}

export function createWorkflowTemplate(name: string): Promise<WorkflowTemplate> {
  return apiFetch('/admin/workflow-templates', { method: 'POST', body: JSON.stringify({ name }) });
}

export interface AddStageInput {
  stageOrder: number;
  name: string;
  assigneeType: 'user' | 'role' | 'group';
  assigneeUserId?: string;
  assigneeRoleId?: string;
  assigneeGroupId?: string;
  allowedActions: string[];
}

export function addWorkflowStage(workflowTemplateId: string, input: AddStageInput): Promise<WorkflowStage> {
  return apiFetch(`/admin/workflow-templates/${workflowTemplateId}/stages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdateStageInput {
  name: string;
  assigneeType: 'user' | 'role' | 'group';
  assigneeUserId?: string;
  assigneeRoleId?: string;
  assigneeGroupId?: string;
  allowedActions: string[];
}

export function updateWorkflowStage(
  workflowTemplateId: string,
  stageOrder: number,
  input: UpdateStageInput,
): Promise<WorkflowStage> {
  return apiFetch(`/admin/workflow-templates/${workflowTemplateId}/stages/${stageOrder}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
