import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, listUsers } from '../../api/users';
import { ApiError } from '../../api/client';

export function UsersPage() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery({ queryKey: ['adminUsers'], queryFn: listUsers });
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createUser({ email, password, fullName: fullName || undefined, isAdmin }),
    onSuccess: () => {
      setEmail('');
      setFullName('');
      setPassword('');
      setIsAdmin(false);
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create user'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Users</h1>

      <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Full name
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Admin
        </label>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create user
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {users?.map((user) => (
          <li key={user.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              {user.full_name || user.email} <span className="text-gray-500">({user.email})</span>
            </span>
            {user.is_admin && <span className="text-xs font-medium text-blue-700">Admin</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
