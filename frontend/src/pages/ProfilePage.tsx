import { FormEvent, useState } from 'react';
import { updateProfile } from '../api/auth';
import { ApiError } from '../api/client';

export function ProfilePage() {
  const [fullName, setFullName] = useState('');
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  async function handleNameSubmit(event: FormEvent) {
    event.preventDefault();
    setNameError(null);
    setNameMessage(null);
    setIsSavingName(true);
    try {
      await updateProfile({ fullName });
      setNameMessage('Display name updated.');
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Failed to update display name');
    } finally {
      setIsSavingName(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setIsSavingPassword(true);
    try {
      await updateProfile({ newPassword });
      setPasswordMessage('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-bold">Profile</h1>

      <form onSubmit={handleNameSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Display name</h2>
        {nameMessage && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{nameMessage}</p>}
        {nameError && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{nameError}</p>}
        <label className="block text-sm">
          Name
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSavingName}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSavingName ? 'Saving...' : 'Save name'}
        </button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Change password</h2>
        {passwordMessage && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{passwordMessage}</p>}
        {passwordError && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{passwordError}</p>}
        <label className="block text-sm">
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
        <label className="block text-sm">
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
          disabled={isSavingPassword}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSavingPassword ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
