import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminInstances, reassignInstance, cancelInstance, AdminInstanceListItem } from '../../api/instances';
import { listDocumentTypes } from '../../api/documentTypes';
import { listUsers } from '../../api/users';
import { ApiError } from '../../api/client';
import { getSlaBadgeInfo } from '../../utils/sla';

export function AdminInstancesPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Reassignment Modal state
  const [reassigningInstance, setReassigningInstance] = useState<AdminInstanceListItem | null>(null);
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [reassignComment, setReassignComment] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);

  // Cancellation Modal state
  const [cancellingInstance, setCancellingInstance] = useState<AdminInstanceListItem | null>(null);
  const [cancelComment, setCancelComment] = useState<string>('');
  const [cancelModalError, setCancelModalError] = useState<string | null>(null);

  const {
    data: instances,
    isLoading: isInstancesLoading,
    error: instancesError,
  } = useQuery({
    queryKey: ['adminInstances', statusFilter, docTypeFilter],
    queryFn: () =>
      listAdminInstances({
        status: statusFilter !== 'all' && statusFilter !== 'overdue' ? statusFilter : undefined,
        isOverdue: statusFilter === 'overdue' ? true : undefined,
        documentTypeId: docTypeFilter || undefined,
      }),
  });

  const { data: documentTypes } = useQuery({
    queryKey: ['documentTypes'],
    queryFn: listDocumentTypes,
  });

  const { data: users } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: listUsers,
  });

  const reassignMutation = useMutation({
    mutationFn: ({ instanceId, userId, comment }: { instanceId: string; userId: string; comment?: string }) =>
      reassignInstance(instanceId, userId, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminInstances'] });
      closeReassignModal();
    },
    onError: (err) => {
      setModalError(err instanceof ApiError ? err.message : 'Failed to reassign instance');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ instanceId, comment }: { instanceId: string; comment?: string }) =>
      cancelInstance(instanceId, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminInstances'] });
      setCancellingInstance(null);
      setCancelComment('');
      setCancelModalError(null);
    },
    onError: (err) => {
      setCancelModalError(err instanceof ApiError ? err.message : 'Failed to cancel instance');
    },
  });

  function openReassignModal(instance: AdminInstanceListItem) {
    setReassigningInstance(instance);
    setTargetUserId(instance.claimed_by || '');
    setReassignComment('');
    setModalError(null);
  }

  function closeReassignModal() {
    setReassigningInstance(null);
    setTargetUserId('');
    setReassignComment('');
    setModalError(null);
  }

  function handleReassignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reassigningInstance || !targetUserId) return;
    setModalError(null);
    reassignMutation.mutate({
      instanceId: reassigningInstance.id,
      userId: targetUserId,
      comment: reassignComment.trim() || undefined,
    });
  }

  function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cancellingInstance) return;
    setCancelModalError(null);
    cancelMutation.mutate({
      instanceId: cancellingInstance.id,
      comment: cancelComment.trim() || undefined,
    });
  }

  const filteredInstances = useMemo(() => {
    if (!instances) return [];
    if (!searchQuery.trim()) return instances;

    const query = searchQuery.toLowerCase().trim();
    return instances.filter((inst) => {
      const ticket = `wf-${String(inst.ticket_number).padStart(6, '0')}`.toLowerCase();
      const docName = (inst.document_type_name || '').toLowerCase();
      const creator = `${inst.creator_name || ''} ${inst.creator_email || ''}`.toLowerCase();
      const claimant = `${inst.claimant_name || ''} ${inst.claimant_email || ''}`.toLowerCase();
      const stage = (inst.currentStage?.name || '').toLowerCase();

      return (
        ticket.includes(query) ||
        docName.includes(query) ||
        creator.includes(query) ||
        claimant.includes(query) ||
        stage.includes(query)
      );
    });
  }, [instances, searchQuery]);

  const stats = useMemo(() => {
    if (!instances) return { total: 0, inProgress: 0, overdue: 0, completed: 0, rejected: 0, cancelled: 0 };
    return {
      total: instances.length,
      inProgress: instances.filter((i) => i.status === 'in_progress').length,
      overdue: instances.filter((i) => i.is_overdue).length,
      completed: instances.filter((i) => i.status === 'completed').length,
      rejected: instances.filter((i) => i.status === 'rejected').length,
      cancelled: instances.filter((i) => i.status === 'cancelled').length,
    };
  }, [instances]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Instances</h1>
          <p className="text-sm text-gray-500">Monitor all workflows across the tenant and manage reassignments.</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total Filtered</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">In Progress</div>
          <div className="mt-1 text-2xl font-bold text-blue-700">{stats.inProgress}</div>
        </div>
        <div className={`rounded-lg border p-4 shadow-sm ${stats.overdue > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <div className={`text-xs font-semibold uppercase tracking-wider ${stats.overdue > 0 ? 'text-red-700' : 'text-gray-500'}`}>
            Overdue
          </div>
          <div className={`mt-1 text-2xl font-bold ${stats.overdue > 0 ? 'text-red-700' : 'text-gray-900'}`}>{stats.overdue}</div>
        </div>
        <div className="rounded-lg border border-green-100 bg-green-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-green-600">Completed</div>
          <div className="mt-1 text-2xl font-bold text-green-700">{stats.completed}</div>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50/50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-red-600">Rejected</div>
          <div className="mt-1 text-2xl font-bold text-red-700">{stats.rejected}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-600">Cancelled</div>
          <div className="mt-1 text-2xl font-bold text-zinc-700">{stats.cancelled}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Pills */}
          {(['all', 'in_progress', 'overdue', 'completed', 'rejected', 'cancelled'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === st
                  ? st === 'overdue' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
              }`}
            >
              {st === 'all'
                ? 'All Statuses'
                : st === 'in_progress'
                ? 'In Progress'
                : st === 'overdue'
                ? 'Overdue'
                : st === 'cancelled'
                ? 'Cancelled'
                : st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Document Type Dropdown */}
          <select
            value={docTypeFilter}
            onChange={(e) => setDocTypeFilter(e.target.value)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Document Types</option>
            {documentTypes?.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>

          {/* Search box */}
          <input
            type="text"
            placeholder="Search ticket, name, user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {isInstancesLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading workflow instances...</div>
        ) : instancesError ? (
          <div className="p-8 text-center text-sm text-red-600">Failed to load instances.</div>
        ) : filteredInstances.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No workflow instances found matching your criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Document Type</th>
                  <th className="px-4 py-3">Current Stage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted By</th>
                  <th className="px-4 py-3">Assigned / Claimant</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredInstances.map((inst) => {
                  const ticketFormatted = `WF-${String(inst.ticket_number).padStart(6, '0')}`;
                  return (
                    <tr key={inst.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-blue-600">
                        <Link to={`/instances/${inst.id}`} className="hover:underline">
                          {ticketFormatted}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{inst.document_type_name}</td>
                      <td className="px-4 py-3">
                        {inst.currentStage ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-gray-900 font-medium">{inst.currentStage.name}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              {inst.currentStage.assignee_type === 'group' && inst.currentStage.assignee_group_level && (
                                <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                                  Level {inst.currentStage.assignee_group_level}
                                </span>
                              )}
                              {inst.currentStage.sla_hours && (
                                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                  SLA: {inst.currentStage.sla_hours}h
                                </span>
                              )}
                            </div>
                            {inst.status === 'in_progress' && inst.stage_due_at && (() => {
                              const sla = getSlaBadgeInfo(inst.stage_due_at, inst.is_overdue, inst.status);
                              return sla ? (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] w-fit ${sla.className}`}>
                                  {sla.label}
                                </span>
                              ) : null;
                            })()}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            inst.status === 'in_progress'
                              ? 'bg-blue-50 text-blue-700'
                              : inst.status === 'completed'
                              ? 'bg-green-50 text-green-700'
                              : inst.status === 'rejected'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-zinc-100 text-zinc-700'
                          }`}
                        >
                          {inst.status === 'in_progress'
                            ? 'In Progress'
                            : inst.status === 'completed'
                            ? 'Completed'
                            : inst.status === 'rejected'
                            ? 'Rejected'
                            : 'Cancelled'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-800">{inst.creator_name || 'User'}</span>
                          <span className="text-xs text-gray-500">{inst.creator_email || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {inst.claimant_email ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-800">{inst.claimant_name || 'Claimant'}</span>
                            <span className="text-xs text-gray-500">{inst.claimant_email}</span>
                          </div>
                        ) : (
                          <span className="italic text-gray-400">Unclaimed</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {new Date(inst.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/instances/${inst.id}`}
                            className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            View
                          </Link>
                          {inst.status === 'in_progress' && (
                            <>
                              <button
                                onClick={() => openReassignModal(inst)}
                                className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                              >
                                Reassign
                              </button>
                              <button
                                onClick={() => {
                                  setCancellingInstance(inst);
                                  setCancelComment('');
                                  setCancelModalError(null);
                                }}
                                className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reassignment Modal */}
      {reassigningInstance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">
              Reassign Instance WF-{String(reassigningInstance.ticket_number).padStart(6, '0')}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Document: {reassigningInstance.document_type_name} | Current Stage:{' '}
              {reassigningInstance.currentStage?.name || 'N/A'}
            </p>

            <form onSubmit={handleReassignSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Target Assignee
                </label>
                <select
                  required
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a user...</option>
                  {users?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                      {u.is_admin ? ' [Admin]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Audit Reason / Comment (Optional)
                </label>
                <textarea
                  rows={3}
                  value={reassignComment}
                  onChange={(e) => setReassignComment(e.target.value)}
                  placeholder="e.g., Reassigned due to team member PTO / workload rebalancing"
                  className="mt-1 w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              {modalError && (
                <div className="rounded bg-red-50 p-2 text-xs text-red-700">{modalError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeReassignModal}
                  disabled={reassignMutation.isPending}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!targetUserId || reassignMutation.isPending}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {reassignMutation.isPending ? 'Reassigning...' : 'Confirm Reassignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {cancellingInstance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">
              Cancel Instance WF-{String(cancellingInstance.ticket_number).padStart(6, '0')}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Document: {cancellingInstance.document_type_name} | Submitter:{' '}
              {cancellingInstance.creator_name || cancellingInstance.creator_email || 'User'}
            </p>

            <form onSubmit={handleCancelSubmit} className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                This workflow will be permanently terminated. The submitter will be notified.
              </p>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Administrative Reason / Comment (Optional)
                </label>
                <textarea
                  rows={3}
                  value={cancelComment}
                  onChange={(e) => setCancelComment(e.target.value)}
                  placeholder="e.g., Compliance violation, duplicate submission, or cancelled upon user request"
                  className="mt-1 w-full rounded border border-gray-300 p-2 text-sm focus:border-red-500 focus:outline-none"
                />
              </div>

              {cancelModalError && (
                <div className="rounded bg-red-50 p-2 text-xs text-red-700">{cancelModalError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCancellingInstance(null);
                    setCancelComment('');
                    setCancelModalError(null);
                  }}
                  disabled={cancelMutation.isPending}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Keep Active
                </button>
                <button
                  type="submit"
                  disabled={cancelMutation.isPending}
                  className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
