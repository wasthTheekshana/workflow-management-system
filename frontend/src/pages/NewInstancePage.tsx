import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AdhocStageInput, listStartableDocumentTypes, startInstance } from '../api/instances';
import { listVisibleUsers } from '../api/users';
import { listVisibleGroups } from '../api/groups';
import { ApiError } from '../api/client';

interface StageRow {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
}

function emptyRow(): StageRow {
  return { name: '', assigneeType: 'user', assigneeId: '' };
}

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const { data: visibleUsers } = useQuery({ queryKey: ['visibleUsers'], queryFn: listVisibleUsers });
  const { data: visibleGroups } = useQuery({ queryKey: ['visibleGroups'], queryFn: listVisibleGroups });

  const [documentTypeId, setDocumentTypeId] = useState('');
  const [stageRows, setStageRows] = useState<StageRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);

  const selectedDocumentType = documentTypes?.find((dt) => dt.id === documentTypeId);
  const isAdhoc = selectedDocumentType?.workflow_mode === 'adhoc';

  const startMutation = useMutation({
    mutationFn: () => {
      const stages: AdhocStageInput[] | undefined = isAdhoc
        ? stageRows.map((row) => ({ name: row.name, assigneeType: row.assigneeType, assigneeId: row.assigneeId }))
        : undefined;
      return startInstance(documentTypeId, stages);
    },
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

  function updateRow(index: number, patch: Partial<StageRow>) {
    setStageRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setStageRows((rows) => [...rows, emptyRow()]);
  }

  function removeRow(index: number) {
    setStageRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  const canSubmit =
    Boolean(documentTypeId) &&
    (!isAdhoc || stageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0));

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start a Document</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading document types...</p>}

      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Document type
          <select
            required
            value={documentTypeId}
            onChange={(e) => {
              setDocumentTypeId(e.target.value);
              setStageRows([emptyRow()]);
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
          <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-700">Build the approval steps</p>
            {stageRows.map((row, index) => (
              <div key={index} className="space-y-2 rounded border border-gray-200 bg-white p-2">
                <label className="block text-xs">
                  Stage {index + 1} name
                  <input
                    type="text"
                    required
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={row.assigneeType === 'user'}
                      onChange={() => updateRow(index, { assigneeType: 'user', assigneeId: '' })}
                    />
                    Person
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={row.assigneeType === 'group'}
                      onChange={() => updateRow(index, { assigneeType: 'group', assigneeId: '' })}
                    />
                    Group
                  </label>
                </div>
                <select
                  required
                  value={row.assigneeId}
                  onChange={(e) => updateRow(index, { assigneeId: e.target.value })}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">
                    {row.assigneeType === 'user' ? 'Select a person' : 'Select a group'}
                  </option>
                  {row.assigneeType === 'user'
                    ? visibleUsers?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </option>
                      ))
                    : visibleGroups?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                </select>
                {stageRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove stage
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} className="text-sm text-blue-700 hover:underline">
              + Add stage
            </button>
          </div>
        )}

        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={startMutation.isPending || !canSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Start
        </button>
      </form>
    </div>
  );
}
