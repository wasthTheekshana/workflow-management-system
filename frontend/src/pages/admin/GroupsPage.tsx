import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createGroup, listGroups } from '../../api/groups';
import { ApiError } from '../../api/client';

export function GroupsPage() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create group'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate(name);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Groups</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
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
        {groups?.map((group) => (
          <li key={group.id} className="px-4 py-3 text-sm">
            <Link to={`/admin/groups/${group.id}`} className="text-blue-700 hover:underline">
              {group.name}
            </Link>
            <span className="ml-2 text-gray-500">({group.memberCount} members)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
