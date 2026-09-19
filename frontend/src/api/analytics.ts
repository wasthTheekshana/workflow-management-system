import { apiFetch } from './client';

export interface AnalyticsKPIs {
  totalInstances: number;
  inProgressInstances: number;
  completedInstances: number;
  rejectedInstances: number;
  cancelledInstances: number;
  avgCycleTimeHours: number;
  medianCycleTimeHours: number;
  completionRate: number;
  activeOverdueCount: number;
  overdueRate: number;
}

export interface StageMetric {
  stageId: string;
  stageOrder: number;
  stageName: string;
  workflowTemplateId: string;
  workflowTemplateName: string;
  slaHours: number | null;
  activeQueueCount: number;
  activeOverdueCount: number;
  avgActiveWaitHours: number;
  completedTransitionsCount: number;
  avgTurnaroundHours: number;
  slaBreachCount: number;
  slaComplianceRate: number | null;
  healthStatus: 'bottleneck' | 'at_risk' | 'healthy';
}

export interface TemplateMetric {
  id: string;
  name: string;
  totalInstances: number;
  inProgressCount: number;
  completedCount: number;
  rejectedCount: number;
  cancelledCount: number;
  avgCycleTimeHours: number;
  activeOverdueCount: number;
}

export interface AnalyticsResponse {
  kpis: AnalyticsKPIs;
  stageMetrics: StageMetric[];
  templateMetrics: TemplateMetric[];
}

export function getWorkflowAnalytics(params?: {
  workflowTemplateId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<AnalyticsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.workflowTemplateId) searchParams.append('workflowTemplateId', params.workflowTemplateId);
  if (params?.startDate) searchParams.append('startDate', params.startDate);
  if (params?.endDate) searchParams.append('endDate', params.endDate);
  const qs = searchParams.toString();
  return apiFetch(`/admin/analytics${qs ? `?${qs}` : ''}`);
}

