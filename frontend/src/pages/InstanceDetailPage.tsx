import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addInstanceContentVersion,
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
  uploadInstanceVersion,
  WorkflowInstance,
} from '../api/instances';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { getInstanceEditConfig } from '../api/documentEditing';
import { addComment, listComments } from '../api/comments';
import { DocumentPanel } from '../components/DocumentPanel';

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
  const { data: instanceComments } = useQuery({
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

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['instance', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceHistory', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceContent', id] });
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
    mutationFn: () => sendBackInstance(id!, comment || undefined),
    onSuccess: () => {
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
    onError: (err) => onError(err, 'Failed to post comment'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!detail) return <p className="text-sm text-red-700">Instance not found.</p>;

  const instance = detail;
  const currentStage = detail.currentStage;
  const userId = decoded?.userId ?? '';
  const isMine = instance.status === 'in_progress' && canActLocally(currentStage, instance, userId);
  const canClaim =
    instance.status === 'in_progress' &&
    (currentStage.assignee_type === 'role' || currentStage.assignee_type === 'group') &&
    !instance.claimed_by;
  const canResubmit = instance.status === 'rejected' && instance.created_by === userId;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="max-w-2xl flex-shrink-0 lg:w-[28rem]">
        <h1 className="mb-1 text-xl font-bold">
          WF-{String(instance.ticket_number).padStart(6, '0')} — {history?.documentType.name ?? 'Instance'}
        </h1>
        <p className="mb-6 text-sm text-gray-600">
          Stage: {currentStage.name} — status: {instance.status}
        </p>

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
                  className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
                >
                  Forward
                </button>
              )}
              {currentStage.allowed_actions.includes('send_back') && instance.current_stage_order > 1 && (
                <button
                  onClick={() => sendBackMutation.mutate()}
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
    </div>
  );
}
