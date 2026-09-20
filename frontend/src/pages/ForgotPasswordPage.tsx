import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../api/auth';
import { ApiError } from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(email);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request password reset');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Forgot password</h1>
        {message ? (
          <p className="rounded bg-green-50 p-2 text-sm text-green-700">{message}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <label className="mb-6 block text-sm">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}
        <Link to="/login" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
