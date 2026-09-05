import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ContentFormat, createTemplateFile, listTemplateFiles } from '../../api/templateFiles';
import { ApiError } from '../../api/client';

export function TemplateFilesPage() {
  const queryClient = useQueryClient();
  const { data: templateFiles, isLoading } = useQuery({ queryKey: ['templateFiles'], queryFn: listTemplateFiles });
  const [name, setName] = useState('');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('docx');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createTemplateFile(name, contentFormat),
    onSuccess: () => {
      setName('');
      setContentFormat('docx');
      queryClient.invalidateQueries({ queryKey: ['templateFiles'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create template file'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Template Files</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-center gap-2">
        <input
          type="text"
          required
          placeholder="Template file name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="radio"
            name="contentFormat"
            checked={contentFormat === 'docx'}
            onChange={() => setContentFormat('docx')}
          />
          Word document (.docx)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="radio"
            name="contentFormat"
            checked={contentFormat === 'richtext'}
            onChange={() => setContentFormat('richtext')}
          />
          Rich text
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {templateFiles?.map((templateFile) => (
          <li key={templateFile.id} className="px-4 py-3 text-sm">
            <Link to={`/admin/template-files/${templateFile.id}`} className="text-blue-700 hover:underline">
              {templateFile.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
