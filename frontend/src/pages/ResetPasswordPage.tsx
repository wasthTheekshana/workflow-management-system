import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">
            This reset link is missing its token. Request a new one.
          </p>
          <Link to="/forgot-password" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Reset password</h1>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <label className="mb-3 block text-sm">
          New password
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="mb-6 block text-sm">
          Confirm new password
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
