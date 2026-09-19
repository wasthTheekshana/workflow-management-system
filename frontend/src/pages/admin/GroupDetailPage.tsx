import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addGroupMember, getGroup, removeGroupMember, updateGroupMemberLevel } from '../../api/groups';
import { listUsers } from '../../api/users';
import { ApiError } from '../../api/client';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState(1);
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
    mutationFn: () => addGroupMember(id!, selectedUserId, selectedLevel),
    onSuccess: () => {
      setSelectedUserId('');
      setSelectedLevel(1);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add member'),
  });

  const updateLevelMutation = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: number }) =>
      updateGroupMemberLevel(id!, userId, level),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update member level'),
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
          <li key={member.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-medium text-gray-900">
                {member.full_name ? `${member.full_name} (${member.email})` : member.email}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-gray-500">
                Level:
                <select
                  value={member.level}
                  onChange={(e) =>
                    updateLevelMutation.mutate({ userId: member.id, level: Number(e.target.value) })
                  }
                  disabled={updateLevelMutation.isPending}
                  className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700"
                >
                  <option value={1}>Level 1</option>
                  <option value={2}>Level 2</option>
                  <option value={3}>Level 3</option>
                  <option value={4}>Level 4</option>
                  <option value={5}>Level 5</option>
                </select>
              </label>
              <button
                onClick={() => removeMutation.mutate(member.id)}
                disabled={removeMutation.isPending}
                className="text-sm text-red-700 hover:underline"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
        {group.members.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No members yet.</li>}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Add member</h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <select
          required
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="min-w-[200px] flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a user</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name ? `${user.full_name} (${user.email})` : user.email}
            </option>
          ))}
        </select>
        <select
          value={selectedLevel}
          onChange={(e) => setSelectedLevel(Number(e.target.value))}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value={1}>Level 1 (Junior / Staff)</option>
          <option value={2}>Level 2 (Senior / Reviewer)</option>
          <option value={3}>Level 3 (Lead / Manager)</option>
          <option value={4}>Level 4 (Director / Head)</option>
          <option value={5}>Level 5 (Executive)</option>
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
