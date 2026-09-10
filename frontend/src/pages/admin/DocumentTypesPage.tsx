import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocumentType,
  deleteDocumentType,
  listDocumentTypes,
  updateDocumentType,
  WorkflowMode,
} from '../../api/documentTypes';
import { listTemplateFiles } from '../../api/templateFiles';
import { listWorkflowTemplates } from '../../api/workflowTemplates';
import { ApiError } from '../../api/client';

export function DocumentTypesPage() {
  const queryClient = useQueryClient();
  const { data: documentTypes, isLoading } = useQuery({ queryKey: ['documentTypes'], queryFn: listDocumentTypes });
  const { data: templateFiles } = useQuery({ queryKey: ['templateFiles'], queryFn: listTemplateFiles });
  const { data: workflowTemplates } = useQuery({ queryKey: ['workflowTemplates'], queryFn: listWorkflowTemplates });

  const [name, setName] = useState('');
  const [templateFileId, setTemplateFileId] = useState('');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('predefined');
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createDocumentType({
        name,
        templateFileId,
        workflowMode,
        workflowTemplateId: workflowMode === 'predefined' ? workflowTemplateId : undefined,
      }),
    onSuccess: () => {
      setName('');
      setTemplateFileId('');
      setWorkflowMode('predefined');
      setWorkflowTemplateId('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create document type'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => updateDocumentType(id, { name: newName }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update document type'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete document type'),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate();
  }

  function startEditing(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
  }

  function saveEdit(id: string) {
    updateMutation.mutate({ id, name: editingName });
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Document Types</h1>

      <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Name
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Template file
          <select
            required
            value={templateFileId}
            onChange={(e) => setTemplateFileId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">Select a template file</option>
            {templateFiles?.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={workflowMode === 'predefined'}
              onChange={() => setWorkflowMode('predefined')}
            />
            Predefined workflow
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={workflowMode === 'adhoc'} onChange={() => setWorkflowMode('adhoc')} />
            Users define the workflow when they start it
          </label>
        </div>
        {workflowMode === 'predefined' && (
          <label className="block text-sm">
            Workflow template
            <select
              required
              value={workflowTemplateId}
              onChange={(e) => setWorkflowTemplateId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a workflow template</option>
              {workflowTemplates?.map((wt) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {documentTypes?.map((documentType) => (
          <li key={documentType.id} className="flex items-center justify-between px-4 py-3 text-sm">
            {editingId === documentType.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="mr-2 flex-1 rounded border border-gray-300 px-2 py-1"
              />
            ) : (
              <span>
                {documentType.name}{' '}
                <span className="text-xs text-gray-500">
                  ({documentType.workflow_mode === 'adhoc' ? 'ad-hoc' : 'predefined'})
                </span>
              </span>
            )}
            <span className="flex gap-3">
              {editingId === documentType.id ? (
                <button onClick={() => saveEdit(documentType.id)} className="text-blue-700 hover:underline">
                  Save
                </button>
              ) : (
                <button
                  onClick={() => startEditing(documentType.id, documentType.name)}
                  className="text-blue-700 hover:underline"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => deleteMutation.mutate(documentType.id)}
                className="text-red-700 hover:underline"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
