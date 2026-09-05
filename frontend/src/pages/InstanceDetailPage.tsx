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
import { getInstanceEditConfig, OnlyOfficeConfig } from '../api/documentEditing';
import { OnlineEditor } from '../components/OnlineEditor';
import { RichTextEditor } from '../components/RichTextEditor';

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
  const [error, setError] = useState<string | null>(null);
  const [editorConfig, setEditorConfig] = useState<OnlyOfficeConfig | null>(null);
  const [richTextEditorOpen, setRichTextEditorOpen] = useState(false);

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
  const editConfigMutation = useMutation({
    mutationFn: () => getInstanceEditConfig(id!),
    onSuccess: (config) => {
      setError(null);
      setEditorConfig(config);
    },
    onError: (err) => onError(err, 'Could not open the editor'),
  });
  const saveContentMutation = useMutation({
    mutationFn: (content: unknown) => addInstanceContentVersion(id!, content),
    onSuccess: () => {
      setRichTextEditorOpen(false);
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to save'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  function closeEditor() {
    setEditorConfig(null);
    invalidateAll();
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!detail) return <p className="text-sm text-red-700">Instance not found.</p>;

  const instance = detail;
  const currentStage = detail.currentStage;
  const userId = decoded?.userId ?? '';
  const isMine = instance.status === 'in_progress' && canActLocally(currentStage, instance, userId);
  const canClaim =
    instance.status === 'in_progress' && currentStage.assignee_type === 'role' && !instance.claimed_by;
  const canResubmit = instance.status === 'rejected' && instance.created_by === userId;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">
        WF-{String(instance.ticket_number).padStart(6, '0')} — {history?.documentType.name ?? 'Instance'}
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Stage: {currentStage.name} — status: {instance.status}
      </p>

      {error && <p className="mb-6 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {editorConfig && <OnlineEditor config={editorConfig} onClose={closeEditor} onError={setError} />}

      {richTextEditorOpen && !editorConfig && (
        <RichTextEditor
          title={history?.documentType.name ?? 'Instance'}
          initialContent={currentContent?.content ?? ''}
          editable={isMine}
          saving={saveContentMutation.isPending}
          onSave={isMine ? (content) => saveContentMutation.mutate(content) : undefined}
          onClose={() => setRichTextEditorOpen(false)}
        />
      )}

      {!editorConfig && !richTextEditorOpen && (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {!isRichText && (
              <button
                onClick={() => downloadMutation.mutate()}
                disabled={downloadMutation.isPending}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                Download current file
              </button>
            )}

            {isRichText && (
              <button
                onClick={() => setRichTextEditorOpen(true)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                View document
              </button>
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
              <>
                <button
                  onClick={() => editConfigMutation.mutate()}
                  disabled={editConfigMutation.isPending}
                  className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                >
                  Edit Online
                </button>
                <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                  Upload new version
                  <input
                    type="file"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={uploadMutation.isPending}
                  />
                </label>
              </>
            )}

            {isMine && isRichText && (
              <button
                onClick={() => setRichTextEditorOpen(true)}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                Edit
              </button>
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
        </>
      )}
    </div>
  );
}
