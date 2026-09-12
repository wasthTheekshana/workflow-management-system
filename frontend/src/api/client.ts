const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
export const TOKEN_STORAGE_KEY = 'workflow_engine_token';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

function handleUnauthorized() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function baseFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && token) {
    handleUnauthorized();
    throw new ApiError(401, 'Session expired');
  }

  return response;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers = new Headers(options.headers);
  if (!isFormData && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await baseFetch(path, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, body.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function apiFetchBlob(path: string): Promise<Blob> {
  const response = await baseFetch(path);
  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to download file');
  }
  return response.blob();
}
