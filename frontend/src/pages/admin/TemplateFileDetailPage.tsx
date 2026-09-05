import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addTemplateFileContentVersion, getTemplateFile, uploadTemplateFileVersion } from '../../api/templateFiles';
import { getTemplateEditConfig } from '../../api/documentEditing';
import { DocumentPanel } from '../../components/DocumentPanel';
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

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['templateFile', id] });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadTemplateFileVersion(id!, file),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Upload failed'),
  });

  const saveContentMutation = useMutation({
    mutationFn: (content: unknown) => addTemplateFileContentVersion(id!, content),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save'),
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

  const isRichText = templateFile.content_format === 'richtext';
  const latestVersion = templateFile.versions[0];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="max-w-2xl flex-shrink-0 lg:w-[28rem]">
        <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>

        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="mb-6 flex flex-wrap gap-2">
          {!isRichText && (
            <>
              <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                Upload new version
                <input
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={uploadMutation.isPending}
                />
              </label>
              <button
                onClick={invalidate}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                Refresh status
              </button>
            </>
          )}
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
      </div>

      <div className="min-h-[70vh] flex-1">
        <DocumentPanel
          format={templateFile.content_format}
          title={templateFile.name}
          richText={
            isRichText
              ? {
                  content: latestVersion?.content ?? '',
                  editable: true,
                  saving: saveContentMutation.isPending,
                  onSave: (content) => saveContentMutation.mutate(content),
                }
              : undefined
          }
          docxQueryKey={['templateEditConfig', id]}
          fetchDocxConfig={() => getTemplateEditConfig(id!)}
          docxEnabled={templateFile.versions.length > 0}
          onError={setError}
        />
      </div>
    </div>
  );
}
