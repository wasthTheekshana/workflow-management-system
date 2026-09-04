import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addGroupMember, getGroup, removeGroupMember } from '../../api/groups';
import { listUsers } from '../../api/users';
import { ApiError } from '../../api/client';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', id],
    queryFn: () => getGroup(id!),
    enabled: Boolean(id),
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['group', id] });
  }

  const addMutation = useMutation({
    mutationFn: () => addGroupMember(id!, selectedUserId),
    onSuccess: () => {
      setSelectedUserId('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add member'),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeGroupMember(id!, userId),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to remove member'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    addMutation.mutate();
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!group) return <p className="text-sm text-red-700">Group not found.</p>;

  const memberIds = new Set(group.members.map((m) => m.id));
  const availableUsers = users?.filter((u) => !memberIds.has(u.id)) ?? [];

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{group.name}</h1>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Members</h2>
      <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {group.members.map((member) => (
          <li key={member.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{member.full_name ? `${member.full_name} (${member.email})` : member.email}</span>
            <button
              onClick={() => removeMutation.mutate(member.id)}
              disabled={removeMutation.isPending}
              className="text-sm text-red-700 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
        {group.members.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No members yet.</li>}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Add member</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <select
          required
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a user</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name ? `${user.full_name} (${user.email})` : user.email}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
