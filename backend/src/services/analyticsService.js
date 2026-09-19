const db = require('../config/db');

/**
 * Calculates operational bottleneck and cycle time analytics for a given tenant.
 *
 * @param {string} tenantId
 * @param {object} options
 * @param {string} [options.workflowTemplateId]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Promise<object>}
 */
async function getWorkflowAnalytics(tenantId, options = {}) {
  const { workflowTemplateId, startDate, endDate } = options;

  // Base query for workflow instances
  let instancesQuery = db('workflow_instances')
    .where('workflow_instances.tenant_id', tenantId);

  if (workflowTemplateId) {
    instancesQuery = instancesQuery.where('workflow_instances.workflow_template_id', workflowTemplateId);
  }
  if (startDate) {
    instancesQuery = instancesQuery.where('workflow_instances.created_at', '>=', new Date(startDate));
  }
  if (endDate) {
    instancesQuery = instancesQuery.where('workflow_instances.created_at', '<=', new Date(endDate));
  }

  const instances = await instancesQuery.select('*');

  // Query workflow templates
  let templatesQuery = db('workflow_templates').where({ tenant_id: tenantId });
  if (workflowTemplateId) {
    templatesQuery = templatesQuery.where({ id: workflowTemplateId });
  }
  const templates = await templatesQuery.select('id', 'name');
  const templateMap = new Map(templates.map((t) => [t.id, t.name]));

  // Query workflow stages
  let stagesQuery = db('workflow_stages')
    .where('workflow_stages.tenant_id', tenantId)
    .orderBy('stage_order', 'asc');
  if (workflowTemplateId) {
    stagesQuery = stagesQuery.where('workflow_stages.workflow_template_id', workflowTemplateId);
  }
  const stages = await stagesQuery.select('*');

  // Query stage actions for turnaround time calculation
  let actionsQuery = db('stage_actions')
    .join('workflow_instances', 'workflow_instances.id', 'stage_actions.workflow_instance_id')
    .where('stage_actions.tenant_id', tenantId)
    .whereIn('stage_actions.action_type', ['forward', 'send_back', 'reject']);

  if (workflowTemplateId) {
    actionsQuery = actionsQuery.where('workflow_instances.workflow_template_id', workflowTemplateId);
  }
  if (startDate) {
    actionsQuery = actionsQuery.where('stage_actions.created_at', '>=', new Date(startDate));
  }
  if (endDate) {
    actionsQuery = actionsQuery.where('stage_actions.created_at', '<=', new Date(endDate));
  }

  const transitionActions = await actionsQuery.select(
    'stage_actions.*',
    'workflow_instances.workflow_template_id',
    'workflow_instances.created_at as instance_created_at'
  ).orderBy('stage_actions.created_at', 'asc');

  // Pre-fetch all actions per instance to compute stage dwell times accurately
  const instanceActionsMap = new Map();
  for (const action of transitionActions) {
    if (!instanceActionsMap.has(action.workflow_instance_id)) {
      instanceActionsMap.set(action.workflow_instance_id, []);
    }
    instanceActionsMap.get(action.workflow_instance_id).push(action);
  }

  const now = new Date();

  // --- Calculate Overall KPIs ---
  const totalInstances = instances.length;
  const inProgressInstances = instances.filter((i) => i.status === 'in_progress').length;
  const completedInstances = instances.filter((i) => i.status === 'completed');
  const rejectedInstances = instances.filter((i) => i.status === 'rejected').length;
  const cancelledInstances = instances.filter((i) => i.status === 'cancelled').length;

  // Cycle time for completed instances
  const cycleTimesHours = completedInstances.map((i) => {
    const start = new Date(i.created_at).getTime();
    const end = new Date(i.updated_at).getTime();
    return Math.max(0, (end - start) / (1000 * 60 * 60));
  });

  const avgCycleTimeHours =
    cycleTimesHours.length > 0
      ? Math.round((cycleTimesHours.reduce((a, b) => a + b, 0) / cycleTimesHours.length) * 10) / 10
      : 0;

  let medianCycleTimeHours = 0;
  if (cycleTimesHours.length > 0) {
    const sorted = [...cycleTimesHours].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianCycleTimeHours =
      sorted.length % 2 !== 0
        ? Math.round(sorted[mid] * 10) / 10
        : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  }

  const resolvedCount = completedInstances.length + rejectedInstances + cancelledInstances;
  const completionRate =
    resolvedCount > 0
      ? Math.round((completedInstances.length / resolvedCount) * 1000) / 10
      : 0;

  const activeOverdueInstances = instances.filter(
    (i) => i.status === 'in_progress' && i.stage_due_at && new Date(i.stage_due_at) < now
  );
  const activeOverdueCount = activeOverdueInstances.length;
  const overdueRate =
    inProgressInstances > 0
      ? Math.round((activeOverdueCount / inProgressInstances) * 1000) / 10
      : 0;

  // --- Calculate Stage Durations from Transition Actions ---
  // Map key: `${workflow_template_id}_${stage_order}`
  const stageDurationsMap = new Map();
  for (const [instanceId, actions] of instanceActionsMap.entries()) {
    let lastTimestamp = null;
    for (let idx = 0; idx < actions.length; idx++) {
      const act = actions[idx];
      const stageKey = `${act.workflow_template_id}_${act.from_stage_order}`;
      const actTime = new Date(act.created_at).getTime();

      // If it's the first action on the instance, stage 1 began at instance.created_at
      const startTime = lastTimestamp || new Date(act.instance_created_at).getTime();
      const durationHours = Math.max(0, (actTime - startTime) / (1000 * 60 * 60));

      if (!stageDurationsMap.has(stageKey)) {
        stageDurationsMap.set(stageKey, []);
      }
      stageDurationsMap.get(stageKey).push(durationHours);

      lastTimestamp = actTime;
    }
  }

  // --- Compile Stage Metrics & Bottlenecks ---
  const stageMetrics = stages.map((stage) => {
    const stageKey = `${stage.workflow_template_id}_${stage.stage_order}`;
    const stageTemplateName = templateMap.get(stage.workflow_template_id) || 'Unnamed Workflow';

    // Active queue at this stage
    const activeAtStage = instances.filter(
      (i) => i.status === 'in_progress' &&
        i.workflow_template_id === stage.workflow_template_id &&
        i.current_stage_order === stage.stage_order
    );
    const activeQueueCount = activeAtStage.length;

    // Active overdue at this stage
    const activeOverdueAtStage = activeAtStage.filter(
      (i) => i.stage_due_at && new Date(i.stage_due_at) < now
    );
    const activeStageOverdueCount = activeOverdueAtStage.length;

    // Average active wait time for instances currently waiting
    const activeWaitDurations = activeAtStage.map((i) => {
      const entry = i.stage_entered_at ? new Date(i.stage_entered_at).getTime() : new Date(i.created_at).getTime();
      return Math.max(0, (now.getTime() - entry) / (1000 * 60 * 60));
    });
    const avgActiveWaitHours =
      activeWaitDurations.length > 0
        ? Math.round((activeWaitDurations.reduce((a, b) => a + b, 0) / activeWaitDurations.length) * 10) / 10
        : 0;

    // Historical completed transitions and duration
    const historicalDurations = stageDurationsMap.get(stageKey) || [];
    const completedTransitionsCount = historicalDurations.length;
    const avgTurnaroundHours =
      historicalDurations.length > 0
        ? Math.round((historicalDurations.reduce((a, b) => a + b, 0) / historicalDurations.length) * 10) / 10
        : 0;

    // SLA breaches count (historical transitions that exceeded sla_hours + current overdue)
    let slaBreachCount = activeStageOverdueCount;
    if (stage.sla_hours) {
      const historicalBreaches = historicalDurations.filter((d) => d > stage.sla_hours).length;
      slaBreachCount += historicalBreaches;
    }

    const totalEvaluated = completedTransitionsCount + activeQueueCount;
    const slaComplianceRate =
      totalEvaluated > 0 && stage.sla_hours
        ? Math.round(((totalEvaluated - slaBreachCount) / totalEvaluated) * 1000) / 10
        : null;

    // Determine Health Status
    // 'bottleneck': overdue count > 0 OR (queue >= 3 AND wait > sla_hours)
    // 'at_risk': queue > 0 AND (wait > 75% of sla_hours OR queue >= 2)
    // 'healthy': otherwise
    let healthStatus = 'healthy';
    if (activeStageOverdueCount > 0 || (activeQueueCount >= 3 && stage.sla_hours && avgActiveWaitHours > stage.sla_hours)) {
      healthStatus = 'bottleneck';
    } else if (
      (stage.sla_hours && avgActiveWaitHours >= stage.sla_hours * 0.75 && activeQueueCount > 0) ||
      activeQueueCount >= 2
    ) {
      healthStatus = 'at_risk';
    }

    return {
      stageId: stage.id,
      stageOrder: stage.stage_order,
      stageName: stage.name,
      workflowTemplateId: stage.workflow_template_id,
      workflowTemplateName: stageTemplateName,
      slaHours: stage.sla_hours || null,
      activeQueueCount,
      activeOverdueCount: activeStageOverdueCount,
      avgActiveWaitHours,
      completedTransitionsCount,
      avgTurnaroundHours,
      slaBreachCount,
      slaComplianceRate,
      healthStatus,
    };
  });

  // Sort stage metrics so bottlenecks appear first, then by activeQueueCount desc
  stageMetrics.sort((a, b) => {
    const statusWeight = { bottleneck: 3, at_risk: 2, healthy: 1 };
    const diff = (statusWeight[b.healthStatus] || 0) - (statusWeight[a.healthStatus] || 0);
    if (diff !== 0) return diff;
    return b.activeQueueCount - a.activeQueueCount;
  });

  // --- Compile Template Breakdown ---
  const templateMetrics = templates.map((tmpl) => {
    const tmplInstances = instances.filter((i) => i.workflow_template_id === tmpl.id);
    const tmplCompleted = tmplInstances.filter((i) => i.status === 'completed');
    const tmplInProgress = tmplInstances.filter((i) => i.status === 'in_progress');
    const tmplRejected = tmplInstances.filter((i) => i.status === 'rejected');
    const tmplCancelled = tmplInstances.filter((i) => i.status === 'cancelled');

    const tmplCycleTimes = tmplCompleted.map((i) => {
      const start = new Date(i.created_at).getTime();
      const end = new Date(i.updated_at).getTime();
      return Math.max(0, (end - start) / (1000 * 60 * 60));
    });

    const tmplAvgCycleTime =
      tmplCycleTimes.length > 0
        ? Math.round((tmplCycleTimes.reduce((a, b) => a + b, 0) / tmplCycleTimes.length) * 10) / 10
        : 0;

    const tmplOverdue = tmplInProgress.filter(
      (i) => i.stage_due_at && new Date(i.stage_due_at) < now
    ).length;

    return {
      id: tmpl.id,
      name: tmpl.name,
      totalInstances: tmplInstances.length,
      inProgressCount: tmplInProgress.length,
      completedCount: tmplCompleted.length,
      rejectedCount: tmplRejected.length,
      cancelledCount: tmplCancelled.length,
      avgCycleTimeHours: tmplAvgCycleTime,
      activeOverdueCount: tmplOverdue,
    };
  });

  return {
    kpis: {
      totalInstances,
      inProgressInstances,
      completedInstances: completedInstances.length,
      rejectedInstances,
      cancelledInstances,
      avgCycleTimeHours,
      medianCycleTimeHours,
      completionRate,
      activeOverdueCount,
      overdueRate,
    },
    stageMetrics,
    templateMetrics,
  };
}

module.exports = {
  getWorkflowAnalytics,
};

