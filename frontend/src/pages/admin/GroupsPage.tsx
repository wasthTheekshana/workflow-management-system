import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminGroup, createGroup, deleteGroup, listGroups, renameGroup } from '../../api/groups';
import { ApiError } from '../../api/client';

export function GroupsPage() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create group'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => renameGroup(id, newName),
    onSuccess: () => {
      setEditingId(null);
      setEditingName('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to rename group'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete group'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate(name);
  }

  function startEditing(group: AdminGroup) {
    setError(null);
    setEditingId(group.id);
    setEditingName(group.name);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingName('');
  }

  function handleRenameSubmit(event: FormEvent, id: string) {
    event.preventDefault();
    setError(null);
    renameMutation.mutate({ id, name: editingName });
  }

  function handleDelete(group: AdminGroup) {
    if (window.confirm(`Delete group "${group.name}"? This cannot be undone.`)) {
      setError(null);
      deleteMutation.mutate(group.id);
    }
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
          <li key={group.id} className="flex items-center justify-between px-4 py-3 text-sm">
            {editingId === group.id ? (
              <form onSubmit={(e) => handleRenameSubmit(e, group.id)} className="flex flex-1 items-center gap-2">
                <input
                  type="text"
                  required
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                  type="submit"
                  disabled={renameMutation.isPending}
                  className="text-sm text-blue-700 hover:underline"
                >
                  Save
                </button>
                <button type="button" onClick={cancelEditing} className="text-sm text-gray-500 hover:underline">
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span>
                  <Link to={`/admin/groups/${group.id}`} className="text-blue-700 hover:underline">
                    {group.name}
                  </Link>
                  <span className="ml-2 text-gray-500">({group.memberCount} members)</span>
                </span>
                <span className="flex gap-3">
                  <button onClick={() => startEditing(group)} className="text-sm text-blue-700 hover:underline">
                    Rename
                  </button>
                  <button
                    onClick={() => handleDelete(group)}
                    disabled={deleteMutation.isPending}
                    className="text-sm text-red-700 hover:underline"
                  >
                    Delete
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
