import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkflowAnalytics } from '../../api/analytics';
import { listWorkflowTemplates } from '../../api/workflowTemplates';

function formatHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}m`;
  }
  if (hours > 48) {
    const days = Math.round((hours / 24) * 10) / 10;
    return `${days}d (${hours}h)`;
  }
  return `${hours}h`;
}

export function AnalyticsPage() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'bottleneck' | 'at_risk' | 'healthy'>('all');

  const { data: templates } = useQuery({
    queryKey: ['workflowTemplates'],
    queryFn: listWorkflowTemplates,
  });

  const { data: analytics, isLoading, error } = useQuery({
    queryKey: ['workflowAnalytics', selectedTemplateId],
    queryFn: () =>
      getWorkflowAnalytics({
        workflowTemplateId: selectedTemplateId || undefined,
      }),
  });

  const filteredStages = useMemo(() => {
    if (!analytics?.stageMetrics) return [];
    if (statusFilter === 'all') return analytics.stageMetrics;
    return analytics.stageMetrics.filter((s) => s.healthStatus === statusFilter);
  }, [analytics?.stageMetrics, statusFilter]);

  const bottleneckCount = useMemo(() => {
    return analytics?.stageMetrics.filter((s) => s.healthStatus === 'bottleneck').length || 0;
  }, [analytics?.stageMetrics]);

  const atRiskCount = useMemo(() => {
    return analytics?.stageMetrics.filter((s) => s.healthStatus === 'at_risk').length || 0;
  }, [analytics?.stageMetrics]);

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading operational analytics...</p>;
  }

  if (error || !analytics) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load operational analytics. Please try again.
      </div>
    );
  }

  const { kpis, templateMetrics } = analytics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operational Bottleneck & Cycle Time Analytics</h1>
          <p className="text-sm text-gray-500">
            Identify process slowdowns, monitor SLA compliance, and evaluate stage turnaround velocity.
          </p>
        </div>

        {/* Template Filter Dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-600">Workflow:</label>
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Workflows</option>
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Avg Cycle Time</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{formatHours(kpis.avgCycleTimeHours)}</div>
          <div className="mt-1 text-[11px] text-gray-500">Median: {formatHours(kpis.medianCycleTimeHours)}</div>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">In-Progress Tasks</div>
          <div className="mt-1 text-2xl font-bold text-blue-800">{kpis.inProgressInstances}</div>
          <div className="mt-1 text-[11px] text-blue-600">Active in workflows</div>
        </div>

        <div
          className={`rounded-lg border p-4 shadow-sm ${
            kpis.activeOverdueCount > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
          }`}
        >
          <div
            className={`text-xs font-semibold uppercase tracking-wider ${
              kpis.activeOverdueCount > 0 ? 'text-red-700' : 'text-gray-500'
            }`}
          >
            Active Overdue
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${
              kpis.activeOverdueCount > 0 ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {kpis.activeOverdueCount}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Overdue rate: {kpis.overdueRate}%</div>
        </div>

        <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Completion Rate</div>
          <div className="mt-1 text-2xl font-bold text-emerald-800">{kpis.completionRate}%</div>
          <div className="mt-1 text-[11px] text-emerald-600">{kpis.completedInstances} of {kpis.totalInstances} completed</div>
        </div>

        <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-purple-700">Bottleneck Stages</div>
          <div className="mt-1 text-2xl font-bold text-purple-900">{bottleneckCount}</div>
          <div className="mt-1 text-[11px] text-purple-600">{atRiskCount} additional at risk</div>
        </div>
      </div>

      {/* Stage Performance & Bottlenecks Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Stage Turnaround & Bottleneck Diagnosis</h2>
            <p className="text-xs text-gray-500">
              Stages with active backlog queues or overdue instances are prioritized.
            </p>
          </div>

          {/* Health Filter Pills */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setStatusFilter('all')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All ({analytics.stageMetrics.length})
            </button>
            <button
              onClick={() => setStatusFilter('bottleneck')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'bottleneck'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              Bottlenecks ({bottleneckCount})
            </button>
            <button
              onClick={() => setStatusFilter('at_risk')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'at_risk'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              At Risk ({atRiskCount})
            </button>
            <button
              onClick={() => setStatusFilter('healthy')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'healthy'
                  ? 'bg-green-600 text-white'
                  : 'bg-green-50 text-green-800 hover:bg-green-100'
              }`}
            >
              Healthy
            </button>
          </div>
        </div>

        {filteredStages.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No stages match the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Workflow & Stage</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Active Queue</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Overdue</th>
                  <th className="px-3 py-2.5 font-semibold">Avg Current Wait</th>
                  <th className="px-3 py-2.5 font-semibold">Avg Turnaround</th>
                  <th className="px-3 py-2.5 font-semibold">SLA Target</th>
                  <th className="px-3 py-2.5 font-semibold">SLA Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStages.map((stage) => {
                  const isBottleneck = stage.healthStatus === 'bottleneck';
                  const isAtRisk = stage.healthStatus === 'at_risk';

                  return (
                    <tr
                      key={stage.stageId}
                      className={`hover:bg-gray-50/80 transition-colors ${
                        isBottleneck ? 'bg-red-50/30' : isAtRisk ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-900">
                          {stage.stageOrder}. {stage.stageName}
                        </div>
                        <div className="text-[11px] text-gray-500">{stage.workflowTemplateName}</div>
                      </td>

                      <td className="px-3 py-3">
                        {isBottleneck && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-600"></span>
                            Bottleneck
                          </span>
                        )}
                        {isAtRisk && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-600"></span>
                            At Risk
                          </span>
                        )}
                        {stage.healthStatus === 'healthy' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                            Healthy
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block min-w-[1.75rem] rounded px-1.5 py-0.5 font-bold ${
                            stage.activeQueueCount > 0
                              ? 'bg-blue-100 text-blue-800'
                              : 'text-gray-400'
                          }`}
                        >
                          {stage.activeQueueCount}
                        </span>
                      </td>

                      <td className="px-3 py-3 text-center">
                        {stage.activeOverdueCount > 0 ? (
                          <span className="inline-block min-w-[1.75rem] rounded bg-red-600 px-1.5 py-0.5 font-bold text-white">
                            {stage.activeOverdueCount}
                          </span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-gray-700">
                        {stage.activeQueueCount > 0 ? formatHours(stage.avgActiveWaitHours) : '—'}
                      </td>

                      <td className="px-3 py-3 text-gray-700">
                        {stage.completedTransitionsCount > 0 ? (
                          <span>
                            {formatHours(stage.avgTurnaroundHours)}{' '}
                            <span className="text-[10px] text-gray-400">({stage.completedTransitionsCount} items)</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-3 py-3 text-gray-700">
                        {stage.slaHours ? (
                          <span className="font-medium text-indigo-700">{stage.slaHours}h</span>
                        ) : (
                          <span className="text-gray-400">Not set</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        {stage.slaComplianceRate !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  stage.slaComplianceRate >= 80
                                    ? 'bg-emerald-500'
                                    : stage.slaComplianceRate >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${Math.min(100, stage.slaComplianceRate)}%` }}
                              ></div>
                            </div>
                            <span className="text-[11px] font-medium text-gray-700">
                              {stage.slaComplianceRate}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Template Breakdown Table */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Workflow Template Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Workflow Name</th>
                <th className="px-3 py-2.5 font-semibold text-center">Total Instances</th>
                <th className="px-3 py-2.5 font-semibold text-center">In Progress</th>
                <th className="px-3 py-2.5 font-semibold text-center">Completed</th>
                <th className="px-3 py-2.5 font-semibold text-center">Overdue</th>
                <th className="px-3 py-2.5 font-semibold">Avg Cycle Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templateMetrics.map((tmpl) => (
                <tr key={tmpl.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-medium text-gray-900">{tmpl.name}</td>
                  <td className="px-3 py-2.5 text-center font-medium text-gray-800">{tmpl.totalInstances}</td>
                  <td className="px-3 py-2.5 text-center text-blue-700 font-medium">{tmpl.inProgressCount}</td>
                  <td className="px-3 py-2.5 text-center text-emerald-700 font-medium">{tmpl.completedCount}</td>
                  <td className="px-3 py-2.5 text-center">
                    {tmpl.activeOverdueCount > 0 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 font-semibold">
                        {tmpl.activeOverdueCount}
                      </span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 font-medium">
                    {formatHours(tmpl.avgCycleTimeHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

