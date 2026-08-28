import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTemplateFile, uploadTemplateFileVersion } from '../../api/templateFiles';
import { ApiError } from '../../api/client';

export function TemplateFileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: templateFile, isLoading } = useQuery({
    queryKey: ['templateFile', id],
    queryFn: () => getTemplateFile(id!),
    enabled: Boolean(id),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadTemplateFileVersion(id!, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templateFile', id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Upload failed'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!templateFile) return <p className="text-sm text-red-700">Template file not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>

      <label className="mb-6 block text-sm">
        <span className="mb-1 block font-medium">Upload new version</span>
        <input type="file" onChange={handleFileChange} disabled={uploadMutation.isPending} />
      </label>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Versions</h2>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {templateFile.versions.map((version) => (
          <li key={version.id} className="px-4 py-3 text-sm">
            v{version.version_number} — uploaded {new Date(version.created_at).toLocaleString()}
          </li>
        ))}
        {templateFile.versions.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No versions uploaded yet.</li>
        )}
      </ul>
    </div>
  );
}
