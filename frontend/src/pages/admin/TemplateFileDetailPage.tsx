import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTemplateFile, uploadTemplateFileVersion } from '../../api/templateFiles';
import { getTemplateEditConfig, OnlyOfficeConfig } from '../../api/documentEditing';
import { OnlineEditor } from '../../components/OnlineEditor';
import { ApiError } from '../../api/client';

export function TemplateFileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editorConfig, setEditorConfig] = useState<OnlyOfficeConfig | null>(null);

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

  const editConfigMutation = useMutation({
    mutationFn: () => getTemplateEditConfig(id!),
    onSuccess: (config) => {
      setError(null);
      setEditorConfig(config);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not open the editor'),
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
    queryClient.invalidateQueries({ queryKey: ['templateFile', id] });
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!templateFile) return <p className="text-sm text-red-700">Template file not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>

      {editorConfig ? (
        <OnlineEditor config={editorConfig} onClose={closeEditor} onError={setError} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => editConfigMutation.mutate()}
              disabled={editConfigMutation.isPending || templateFile.versions.length === 0}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Edit Online
            </button>
            <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
              Upload new version
              <input type="file" onChange={handleFileChange} className="hidden" disabled={uploadMutation.isPending} />
            </label>
          </div>

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
        </>
      )}

      {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
