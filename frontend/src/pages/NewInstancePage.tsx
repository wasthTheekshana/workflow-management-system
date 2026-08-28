import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { listStartableDocumentTypes, startInstance } from '../api/instances';
import { ApiError } from '../api/client';

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => startInstance(documentTypeId),
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

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
            onChange={(e) => setDocumentTypeId(e.target.value)}
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
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={startMutation.isPending || !documentTypeId}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Start
        </button>
      </form>
    </div>
  );
}
