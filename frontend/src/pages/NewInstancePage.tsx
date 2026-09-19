import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AdhocStageInput,
  listStartableDocumentTypes,
  startInstance,
  startInstanceFromOwnDocument,
} from '../api/instances';
import { listVisibleUsers } from '../api/users';
import { listVisibleGroups } from '../api/groups';
import { ApiError } from '../api/client';
import { emptyStageRow, StageBuilder, StageRow } from '../components/StageBuilder';
import { RichTextEditor } from '../components/RichTextEditor';

type StartMode = 'existing' | 'own-document';

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const { data: visibleUsers } = useQuery({ queryKey: ['visibleUsers'], queryFn: listVisibleUsers });
  const { data: visibleGroups } = useQuery({ queryKey: ['visibleGroups'], queryFn: listVisibleGroups });

  const [mode, setMode] = useState<StartMode>('existing');
  const [error, setError] = useState<string | null>(null);

  // "Use an existing document type" mode
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [stageRows, setStageRows] = useState<StageRow[]>([emptyStageRow()]);

  // "Start from my own document" mode
  const [ownName, setOwnName] = useState('');
  const [ownContentFormat, setOwnContentFormat] = useState<'docx' | 'richtext'>('docx');
  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [ownContent, setOwnContent] = useState<unknown>({});
  const [ownStageRows, setOwnStageRows] = useState<StageRow[]>([emptyStageRow()]);

  const selectedDocumentType = documentTypes?.find((dt) => dt.id === documentTypeId);
  const isAdhoc = selectedDocumentType?.workflow_mode === 'adhoc';

  const startMutation = useMutation({
    mutationFn: () => {
      const stages: AdhocStageInput[] | undefined = isAdhoc
        ? stageRows.map((row) => ({
            name: row.name,
            assigneeType: row.assigneeType,
            assigneeId: row.assigneeId,
            assigneeGroupLevel: row.assigneeGroupLevel,
          }))
        : undefined;
      return startInstance(documentTypeId, stages);
    },
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  const startFromOwnDocumentMutation = useMutation({
    mutationFn: () =>
      startInstanceFromOwnDocument({
        name: ownName,
        contentFormat: ownContentFormat,
        file: ownContentFormat === 'docx' ? ownFile ?? undefined : undefined,
        content: ownContentFormat === 'richtext' ? ownContent : undefined,
        stages: ownStageRows.map((row) => ({
          name: row.name,
          assigneeType: row.assigneeType,
          assigneeId: row.assigneeId,
          assigneeGroupLevel: row.assigneeGroupLevel,
        })),
      }),
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleExistingSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

  function handleOwnDocumentSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startFromOwnDocumentMutation.mutate();
  }

  function updateRow(rows: StageRow[], setRows: (rows: StageRow[]) => void, index: number, patch: Partial<StageRow>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const canSubmitExisting =
    Boolean(documentTypeId) &&
    (!isAdhoc || stageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0));

  const canSubmitOwnDocument =
    ownName.trim().length > 0 &&
    (ownContentFormat === 'docx' ? Boolean(ownFile) : true) &&
    ownStageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0);

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start a Document</h1>

      <div className="mb-4 flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name="startMode" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          Use an existing document type
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="startMode"
            checked={mode === 'own-document'}
            onChange={() => setMode('own-document')}
          />
          Start from my own document
        </label>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {mode === 'existing' && (
        <>
          {isLoading && <p className="text-sm text-gray-500">Loading document types...</p>}
          <form onSubmit={handleExistingSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
            <label className="block text-sm">
              Document type
              <select
                required
                value={documentTypeId}
                onChange={(e) => {
                  setDocumentTypeId(e.target.value);
                  setStageRows([emptyStageRow()]);
                }}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              >
                <option value="">Select a document type</option>
                {documentTypes?.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.name}
                  </option>
                ))}
              </select>
            </label>

            {isAdhoc && (
              <StageBuilder
                stageRows={stageRows}
                visibleUsers={visibleUsers}
                visibleGroups={visibleGroups}
                onUpdateRow={(index, patch) => updateRow(stageRows, setStageRows, index, patch)}
                onAddRow={() => setStageRows([...stageRows, emptyStageRow()])}
                onRemoveRow={(index) =>
                  setStageRows(stageRows.length > 1 ? stageRows.filter((_, i) => i !== index) : stageRows)
                }
              />
            )}

            <button
              type="submit"
              disabled={startMutation.isPending || !canSubmitExisting}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start
            </button>
          </form>
        </>
      )}

      {mode === 'own-document' && (
        <form onSubmit={handleOwnDocumentSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
          <label className="block text-sm">
            Document title
            <input
              type="text"
              required
              value={ownName}
              onChange={(e) => setOwnName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="ownContentFormat"
                checked={ownContentFormat === 'docx'}
                onChange={() => setOwnContentFormat('docx')}
              />
              Upload a Word document
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="ownContentFormat"
                checked={ownContentFormat === 'richtext'}
                onChange={() => setOwnContentFormat('richtext')}
              />
              Write rich text
            </label>
          </div>

          {ownContentFormat === 'docx' ? (
            <label className="block text-sm">
              File
              <input
                type="file"
                required
                accept=".docx"
                onChange={(e) => setOwnFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full text-sm"
              />
            </label>
          ) : (
            <div style={{ minHeight: '30vh' }}>
              <RichTextEditor
                title={ownName || 'New document'}
                initialContent={ownContent}
                editable
                onChange={setOwnContent}
              />
            </div>
          )}

          <StageBuilder
            stageRows={ownStageRows}
            visibleUsers={visibleUsers}
            visibleGroups={visibleGroups}
            onUpdateRow={(index, patch) => updateRow(ownStageRows, setOwnStageRows, index, patch)}
            onAddRow={() => setOwnStageRows([...ownStageRows, emptyStageRow()])}
            onRemoveRow={(index) =>
              setOwnStageRows(ownStageRows.length > 1 ? ownStageRows.filter((_, i) => i !== index) : ownStageRows)
            }
          />

          <button
            type="submit"
            disabled={startFromOwnDocumentMutation.isPending || !canSubmitOwnDocument}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start
          </button>
        </form>
      )}
    </div>
  );
}
