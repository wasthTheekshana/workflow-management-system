import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addInstanceContentVersion,
  cancelInstance,
  claimInstance,
  downloadCurrentFile,
  forwardInstance,
  getCurrentContent,
  getInstance,
  getInstanceHistory,
  rejectInstance,
  resubmitInstance,
  sendBackInstance,
  StageInfo,
  unclaimInstance,
  uploadInstanceVersion,
  WorkflowInstance,
} from '../api/instances';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { getInstanceEditConfig } from '../api/documentEditing';
import { addComment, listComments } from '../api/comments';
import {
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from '../api/attachments';
import { getSlaBadgeInfo } from '../utils/sla';
import { DocumentPanel } from '../components/DocumentPanel';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function canActLocally(stage: StageInfo, instance: WorkflowInstance, userId: string): boolean {
  if (instance.claimed_by) {
    return instance.claimed_by === userId;
  }
  if (stage.assignee_type === 'user') {
    return stage.assignee_user_id === userId;
  }
  return false;
}

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { decoded } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isSendBackModalOpen, setIsSendBackModalOpen] = useState(false);
  const [targetStageOrder, setTargetStageOrder] = useState<number | null>(null);
  const [sendBackComment, setSendBackComment] = useState('');

  const { data: detail, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: Boolean(id),
  });
  const { data: history } = useQuery({
    queryKey: ['instanceHistory', id],
    queryFn: () => getInstanceHistory(id!),
    enabled: Boolean(id),
  });
  const { data: instanceComments, error: instanceCommentsError } = useQuery({
    queryKey: ['instanceComments', id],
    queryFn: () => listComments(id!),
    enabled: Boolean(id),
    retry: false,
  });
  const isRichText = detail?.contentFormat === 'richtext';
  const { data: currentContent } = useQuery({
    queryKey: ['instanceContent', id],
    queryFn: () => getCurrentContent(id!),
    enabled: Boolean(id) && isRichText,
  });
  const { data: attachments } = useQuery({
    queryKey: ['instanceAttachments', id],
    queryFn: () => listAttachments(id!),
    enabled: Boolean(id),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['instance', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceHistory', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceContent', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceComments', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceAttachments', id] });
    queryClient.invalidateQueries({ queryKey: ['myTasks'] });
  }

  function onError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  const claimMutation = useMutation({
    mutationFn: () => claimInstance(id!),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to claim'),
  });
  const unclaimMutation = useMutation({
    mutationFn: () => unclaimInstance(id!),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to release/unclaim task'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelInstance(id!, cancelReason.trim() || undefined),
    onSuccess: () => {
      setIsCancelModalOpen(false);
      setCancelReason('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to cancel workflow'),
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadInstanceVersion(id!, file),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Upload failed'),
  });
  const forwardMutation = useMutation({
    mutationFn: () => forwardInstance(id!, comment || undefined),
    onSuccess: () => {
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to forward'),
  });
  const sendBackMutation = useMutation({
    mutationFn: () =>
      sendBackInstance(
        id!,
        sendBackComment.trim() || undefined,
        targetStageOrder !== null ? targetStageOrder : undefined
      ),
    onSuccess: () => {
      setIsSendBackModalOpen(false);
      setSendBackComment('');
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to send back'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectInstance(id!, comment || undefined),
    onSuccess: () => {
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to reject'),
  });
  const resubmitMutation = useMutation({
    mutationFn: () => resubmitInstance(id!),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to resubmit'),
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadCurrentFile(id!),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'current-file.docx';
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => onError(err, 'Download failed'),
  });
  const saveContentMutation = useMutation({
    mutationFn: (content: unknown) => addInstanceContentVersion(id!, content),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to save'),
  });
  const addCommentMutation = useMutation({
    mutationFn: (body: string) => addComment(id!, body),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['instanceComments', id] });
    },
    onError: (err) => {
      onError(err, 'Failed to post comment');
      queryClient.invalidateQueries({ queryKey: ['instanceComments', id] });
    },
  });
  const uploadAttachmentMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(id!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceAttachments', id] });
      queryClient.invalidateQueries({ queryKey: ['instanceHistory', id] });
    },
    onError: (err) => onError(err, 'Failed to upload attachment'),
  });
  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(id!, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceAttachments', id] });
      queryClient.invalidateQueries({ queryKey: ['instanceHistory', id] });
    },
    onError: (err) => onError(err, 'Failed to delete attachment'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  function handleAttachmentUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadAttachmentMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!detail) return <p className="text-sm text-red-700">Instance not found.</p>;

  const instance = detail;
  const currentStage = detail.currentStage;
  const userId = decoded?.userId ?? '';
  const stageApprovals = detail.stageApprovals;
  const isConsensusStage = currentStage?.consensus_type === 'all' || currentStage?.consensus_type === 'any';
  const myApproval = stageApprovals?.eligibleApprovers?.find((ea) => ea.id === userId);
  const isEligibleApprover = Boolean(myApproval || decoded?.isAdmin);
  const hasAlreadyApproved = Boolean(myApproval?.hasApproved);

  const canClaim =
    instance.status === 'in_progress' &&
    (currentStage.assignee_type === 'role' || currentStage.assignee_type === 'group') &&
    currentStage.consensus_type !== 'all' &&
    !instance.claimed_by;
  const canUnclaim =
    instance.status === 'in_progress' &&
    (currentStage.assignee_type === 'role' || currentStage.assignee_type === 'group') &&
    currentStage.consensus_type !== 'all' &&
    !!instance.claimed_by &&
    (instance.claimed_by === userId || decoded?.isAdmin);
  const canCancel =
    instance.status === 'in_progress' &&
    (instance.created_by === userId || !!decoded?.isAdmin);
  const canResubmit =
    (instance.status === 'rejected' || instance.status === 'cancelled') &&
    instance.created_by === userId;

  const isMine =
    instance.status === 'in_progress' &&
    (isConsensusStage
      ? isEligibleApprover && !hasAlreadyApproved
      : canActLocally(currentStage, instance, userId));

  const allStages = detail.workflowStages || history?.workflowStages || [];
  const previousStages = allStages.filter((s) => s.stage_order < (instance.current_stage_order ?? 1));

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="max-w-2xl flex-shrink-0 lg:w-[28rem]">
        <h1 className="mb-1 text-xl font-bold">
          WF-{String(instance.ticket_number).padStart(6, '0')} — {history?.documentType.name ?? 'Instance'}
        </h1>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>
            Stage: <strong className="text-gray-900">{currentStage ? currentStage.name : '—'}</strong>
            {currentStage?.assignee_type === 'group' && currentStage.assignee_group_level
              ? ` (Group Level ${currentStage.assignee_group_level})`
              : ''}
          </span>
          <span>•</span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              instance.status === 'in_progress'
                ? 'bg-blue-100 text-blue-800'
                : instance.status === 'completed'
                ? 'bg-green-100 text-green-800'
                : instance.status === 'rejected'
                ? 'bg-red-100 text-red-800'
                : 'bg-zinc-200 text-zinc-800'
            }`}
          >
            {instance.status === 'in_progress'
              ? 'In Progress'
              : instance.status === 'completed'
              ? 'Completed'
              : instance.status === 'rejected'
              ? 'Rejected'
              : 'Cancelled'}
          </span>
          {currentStage?.consensus_type === 'all' && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800 border border-purple-200">
              AND Consensus
            </span>
          )}
          {currentStage?.consensus_type === 'any' && (
            <span className="inline-flex items-center rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-semibold text-cyan-800 border border-cyan-200">
              OR Consensus
            </span>
          )}
          {(() => {
            const sla = getSlaBadgeInfo(instance.stage_due_at, instance.is_overdue, instance.status);
            return sla ? (
              <>
                <span>•</span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${sla.className}`}>
                  {sla.label}
                </span>
              </>
            ) : null;
          })()}
        </div>

        {instance.status === 'in_progress' && (currentStage?.sla_hours || instance.stage_due_at) && (
          <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-900">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-indigo-950">Stage SLA Tracking</span>
              {currentStage?.sla_hours && (
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-800">
                  Target: {currentStage.sla_hours}h
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-indigo-700">
              {instance.stage_entered_at && (
                <span>Started: {new Date(instance.stage_entered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
              )}
              {instance.stage_due_at && (
                <span>Due: {new Date(instance.stage_due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </div>
        )}

        {instance.status === 'in_progress' && isConsensusStage && stageApprovals && (
          <div className="mb-6 rounded-lg border border-purple-200 bg-purple-50/40 p-4 text-xs text-purple-950">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-purple-900">
                  {stageApprovals.consensusType === 'all' ? 'Parallel AND Consensus' : 'Parallel OR Consensus'}
                </span>
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
                  {stageApprovals.approvedCount} / {stageApprovals.totalRequired} Approved
                </span>
              </div>
              <span className="text-xs text-purple-700">
                {stageApprovals.consensusType === 'all' ? 'All members required' : 'Any 1 member required'}
              </span>
            </div>

            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-purple-200">
              <div
                className="h-full bg-purple-600 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((stageApprovals.approvedCount / Math.max(1, stageApprovals.totalRequired)) * 100))}%`,
                }}
              />
            </div>

            <div className="mt-3 space-y-1.5 divide-y divide-purple-100">
              {stageApprovals.eligibleApprovers.map((approver) => (
                <div key={approver.id} className="pt-1.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {approver.hasApproved ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-green-700 font-bold text-[10px]">
                        ✓
                      </span>
                    ) : (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 font-bold text-[10px]">
                        ⏳
                      </span>
                    )}
                    <span className="font-medium text-gray-800">{approver.email}</span>
                    {approver.level && (
                      <span className="rounded bg-purple-100 px-1 py-0.2 text-[10px] text-purple-800 font-semibold">
                        Lv {approver.level}
                      </span>
                    )}
                  </div>
                  <div>
                    {approver.hasApproved ? (
                      <span className="text-green-700 font-semibold">
                        Approved {approver.approvedAt ? `(${new Date(approver.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
                      </span>
                    ) : (
                      <span className="text-amber-700">Pending Approval</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {hasAlreadyApproved && (
              <div className="mt-3 rounded bg-green-50 p-2 text-xs font-medium text-green-800 border border-green-200 flex items-center gap-1.5">
                <span>✓</span> You have approved this stage. Waiting for remaining required members.
              </div>
            )}
          </div>
        )}

        {error && <p className="mb-6 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="mb-6 flex flex-wrap gap-2">
          {!isRichText && (
            <>
              <button
                onClick={() => downloadMutation.mutate()}
                disabled={downloadMutation.isPending}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                Download current file
              </button>
              <button
                onClick={invalidateAll}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                Refresh status
              </button>
            </>
          )}

          {canClaim && (
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            >
              Claim
            </button>
          )}

          {canUnclaim && (
            <button
              onClick={() => unclaimMutation.mutate()}
              disabled={unclaimMutation.isPending}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              Release / Unclaim
            </button>
          )}

          {canCancel && (
            <button
              onClick={() => {
                setCancelReason('');
                setIsCancelModalOpen(true);
              }}
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Cancel Workflow
            </button>
          )}

          {isMine && !isRichText && (
            <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
              Upload new version
              <input
                type="file"
                onChange={handleFileChange}
                className="hidden"
                disabled={uploadMutation.isPending}
              />
            </label>
          )}

          {canResubmit && (
            <button
              onClick={() => resubmitMutation.mutate()}
              disabled={resubmitMutation.isPending}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            >
              Resubmit
            </button>
          )}
        </div>

        {isMine && (
          <div className="mb-6 rounded border border-gray-200 bg-white p-4">
            <label className="mb-3 block text-sm">
              Comment (optional)
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <div className="flex gap-2">
              {currentStage.allowed_actions.includes('forward') && (
                <button
                  onClick={() => forwardMutation.mutate()}
                  disabled={forwardMutation.isPending}
                  className="rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  {isConsensusStage ? 'Approve Stage' : 'Forward'}
                </button>
              )}
              {currentStage.allowed_actions.includes('send_back') && instance.current_stage_order > 1 && (
                <button
                  onClick={() => {
                    setTargetStageOrder(instance.current_stage_order - 1);
                    setSendBackComment(comment);
                    setIsSendBackModalOpen(true);
                  }}
                  disabled={sendBackMutation.isPending}
                  className="rounded bg-yellow-600 px-3 py-2 text-sm text-white hover:bg-yellow-700"
                >
                  Send Back
                </button>
              )}
              {currentStage.allowed_actions.includes('reject') && (
                <button
                  onClick={() => {
                    if (window.confirm('Reject this document? This cannot be undone.')) {
                      rejectMutation.mutate();
                    }
                  }}
                  disabled={rejectMutation.isPending}
                  className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold text-gray-700">Version History</h2>
        <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
          {history?.versions.map((version) => (
            <li key={version.id} className="px-4 py-3 text-sm">
              v{version.version_number} — {new Date(version.created_at).toLocaleString()}
            </li>
          ))}
          {history?.versions.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500">No versions uploaded yet.</li>
          )}
        </ul>

        <h2 className="mb-2 text-sm font-semibold text-gray-700">Audit Log</h2>
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
          {history?.auditLog.map((action) => (
            <li key={action.id} className="px-4 py-3 text-sm">
              <span className="font-medium">{action.action_type}</span>
              {' — '}
              {new Date(action.created_at).toLocaleString()}
              {action.comment && <span className="block text-gray-600">"{action.comment}"</span>}
            </li>
          ))}
          {history?.auditLog.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500">No actions recorded yet.</li>
          )}
        </ul>

        <div className="mb-6 mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Supporting Attachments {attachments && attachments.length > 0 ? `(${attachments.length})` : ''}
            </h2>
            {instance.status === 'in_progress' && (
              <label className="cursor-pointer rounded bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 border border-blue-200">
                + Add File
                <input
                  type="file"
                  onChange={handleAttachmentUpload}
                  disabled={uploadAttachmentMutation.isPending}
                  className="hidden"
                />
              </label>
            )}
          </div>
          {uploadAttachmentMutation.isPending && (
            <p className="mb-2 text-xs text-blue-600 animate-pulse">Uploading attachment...</p>
          )}
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white shadow-sm">
            {attachments?.map((att) => {
              const canDelete =
                instance.status === 'in_progress' &&
                (att.uploaded_by === decoded?.userId || decoded?.isAdmin);

              return (
                <li key={att.id} className="p-3 text-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800 break-all text-xs sm:text-sm">{att.file_name}</span>
                    <span className="shrink-0 text-xs text-gray-500 font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                      {formatBytes(att.file_size_bytes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {att.uploader_name || att.uploader_email || 'User'} • {new Date(att.created_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => downloadAttachment(instance.id, att.id, att.file_name)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        Download
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete attachment "${att.file_name}"?`)) {
                              deleteAttachmentMutation.mutate(att.id);
                            }
                          }}
                          disabled={deleteAttachmentMutation.isPending}
                          className="text-red-600 hover:text-red-800 hover:underline font-medium"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {(!attachments || attachments.length === 0) && (
              <li className="px-4 py-3 text-sm text-gray-500">No supporting attachments uploaded yet.</li>
            )}
          </ul>
        </div>

        {instanceCommentsError instanceof ApiError && instanceCommentsError.status !== 403 && (
          <p className="mb-3 mt-6 rounded bg-red-50 p-2 text-sm text-red-700">Could not load comments.</p>
        )}
        {instanceComments && (
          <>
            <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Comments</h2>
            <ul className="mb-3 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
              {instanceComments.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <span className="font-medium">{c.author_name}</span>
                  {' — '}
                  {new Date(c.created_at).toLocaleString()}
                  <p className="mt-1 text-gray-700">{c.body}</p>
                </li>
              ))}
              {instanceComments.length === 0 && (
                <li className="px-4 py-3 text-sm text-gray-500">No comments yet.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment"
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => addCommentMutation.mutate(commentBody)}
                disabled={addCommentMutation.isPending || commentBody.trim().length === 0}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </>
        )}
      </div>

      <div className="min-h-[70vh] flex-1">
        <DocumentPanel
          format={detail.contentFormat}
          title={history?.documentType.name ?? 'Instance'}
          richText={
            isRichText
              ? {
                  content: currentContent?.content ?? '',
                  editable: isMine,
                  saving: saveContentMutation.isPending,
                  onSave: isMine ? (content) => saveContentMutation.mutate(content) : undefined,
                }
              : undefined
          }
          docxQueryKey={['instanceEditConfig', id]}
          fetchDocxConfig={() => getInstanceEditConfig(id!)}
          onError={setError}
        />
      </div>

      {isCancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Cancel Workflow Instance</h2>
            <p className="mt-1 text-sm text-gray-500">
              Are you sure you want to cancel WF-{String(instance.ticket_number).padStart(6, '0')}? This workflow will be terminated immediately.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                Cancellation Reason (Optional)
              </label>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g., Request abandoned or submitted by mistake"
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(false)}
                disabled={cancelMutation.isPending}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSendBackModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Send Back Document</h2>
            <p className="mt-1 text-sm text-gray-500">
              Return WF-{String(instance.ticket_number).padStart(6, '0')} to a previous stage for revision.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                Target Stage
              </label>
              {previousStages.length > 0 ? (
                <select
                  value={targetStageOrder ?? instance.current_stage_order - 1}
                  onChange={(e) => setTargetStageOrder(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-gray-300 p-2 text-sm focus:border-yellow-500 focus:outline-none"
                >
                  {previousStages.map((s) => (
                    <option key={s.id} value={s.stage_order}>
                      Stage {s.stage_order}: {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-sm text-gray-600">
                  Stage {instance.current_stage_order - 1} (Previous Stage)
                </p>
              )}
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                Feedback / Reason for Return (Optional)
              </label>
              <textarea
                rows={3}
                value={sendBackComment}
                onChange={(e) => setSendBackComment(e.target.value)}
                placeholder="Explain what needs to be changed or corrected..."
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSendBackModalOpen(false)}
                disabled={sendBackMutation.isPending}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => sendBackMutation.mutate()}
                disabled={sendBackMutation.isPending}
                className="rounded bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
              >
                {sendBackMutation.isPending ? 'Sending Back...' : 'Confirm Send Back'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
