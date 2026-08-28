# Frontend Phase 1 — App Shell & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the frontend skeleton — Vite/React/TypeScript/Tailwind, routing for every page this build will eventually have (as stubs), the API client, auth context, login flow, and route guards — so every later feature-area phase has a working shell to build screens into.

**Architecture:** `apiClient` (thin `fetch` wrapper) → TanStack Query hooks → page components, with a React Context holding the decoded-but-unverified JWT for UI branching (`isAdmin` nav visibility) while the backend remains the actual authorization boundary. React Router mounts a `ProtectedRoute` wrapper (redirects to `/login` with no token) and an `AdminRoute` wrapper (hides `/admin/*` from non-admins) around a shared `Layout` (nav + outlet).

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query. No backend changes.

**Spec:** `docs/superpowers/specs/2026-08-28-frontend-design.md`

## Global Constraints

- The JWT is stored in `localStorage` under a single key and read by `apiClient` on every request — never duplicated into component state as the source of truth. (Spec §3)
- `apiClient` throws a typed `ApiError` carrying the backend's own `{ error: string }` message on any non-2xx response, and clears the token + redirects to `/login` specifically on 401. (Spec §3, §5)
- Client-side admin-route hiding and the decoded-JWT `isAdmin` flag are UX only — never treated as the authorization boundary; the backend's `requireAdmin` middleware is the real gate and every admin API call still goes through it. (Spec §3)
- No automated frontend tests this phase — verification is `npm run build` (catches TypeScript/compile errors), the dev server actually serving pages, and live API-level checks via curl mirroring what the UI calls. (Spec §2 "Automated tests")

---

## Task 1: Project scaffold — Vite, React, TypeScript, Tailwind

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/.gitignore`
- Create: `frontend/.env.example`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`

**Interfaces:**
- Produces: a buildable, servable empty React app. Every later task adds to `App.tsx`'s routing and `src/`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "workflow-engine-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.51.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.25.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.6",
    "typescript": "^5.5.3",
    "vite": "^5.3.4"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `frontend/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 6: Create `frontend/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Workflow Engine</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `frontend/.gitignore`**

```gitignore
node_modules/
dist/
.env
```

- [ ] **Step 9: Create `frontend/.env.example`**

```dotenv
VITE_API_BASE_URL=http://localhost:3000
```

Also create a real `frontend/.env` with the same content (git-ignored, used by the dev server).

- [ ] **Step 10: Create `frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 11: Create `frontend/src/App.tsx`** (placeholder, replaced in Task 3)

```tsx
function App() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Workflow Engine</h1>
    </div>
  );
}

export default App;
```

- [ ] **Step 12: Create `frontend/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 13: Install dependencies and verify the build**

Run:
```bash
cd "d:\Project\Workflow Managment System\frontend"
npm install
npm run build
```
Expected: installs cleanly, `npm run build` produces `dist/` with no TypeScript errors.

- [ ] **Step 14: Verify the dev server serves the page**

Run: `npm run dev` (background), then `curl -s http://localhost:5173/ | grep -o '<title>[^<]*</title>'`
Expected: `<title>Workflow Engine</title>`. Stop the dev server after confirming.

- [ ] **Step 15: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.node.json frontend/tailwind.config.js frontend/postcss.config.js frontend/index.html frontend/.gitignore frontend/.env.example frontend/src/index.css frontend/src/App.tsx frontend/src/main.tsx
git commit -m "chore: scaffold frontend (Vite, React, TypeScript, Tailwind)"
```

---

## Task 2: API client and auth module

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`

**Interfaces:**
- Produces: `class ApiError extends Error { status: number }`, `apiFetch<T>(path: string, options?: RequestInit) -> Promise<T>` (JSON request/response, attaches auth header, throws `ApiError`), `apiFetchBlob(path: string) -> Promise<Blob>` (for file downloads), `login(email: string, password: string) -> Promise<{ token: string }>`, `decodeToken(token: string) -> { userId: string; tenantId: string; isAdmin: boolean } | null`, `TOKEN_STORAGE_KEY`. Every later task's data hooks call `apiFetch`/`apiFetchBlob`; the auth context calls `login`/`decodeToken`.

- [ ] **Step 1: Write `frontend/src/api/client.ts`**

```ts
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

  if (response.status === 401) {
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
```

- [ ] **Step 2: Write `frontend/src/api/auth.ts`**

```ts
import { apiFetch } from './client';

export interface DecodedToken {
  userId: string;
  tenantId: string;
  isAdmin: boolean;
}

export function login(email: string, password: string): Promise<{ token: string }> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function decodeToken(token: string): DecodedToken | null {
  try {
    const payloadBase64 = token.split('.')[1];
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    return {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      isAdmin: Boolean(payload.is_admin),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/api/client.ts frontend/src/api/auth.ts
git commit -m "feat: add frontend API client and auth module"
```

---

## Task 3: Auth context, route guards, and login page

**Files:**
- Create: `frontend/src/context/AuthContext.tsx`
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Create: `frontend/src/components/AdminRoute.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `login`, `decodeToken`, `TOKEN_STORAGE_KEY` (Task 2).
- Produces: `AuthProvider` (React component), `useAuth() -> { token, decoded, isAuthenticated, login, logout }` (hook), `ProtectedRoute` and `AdminRoute` (route-wrapping components), `LoginPage` (component). Task 4 wires all of these into the router and `Layout`.

- [ ] **Step 1: Write `frontend/src/context/AuthContext.tsx`**

```tsx
import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { login as loginRequest, decodeToken, DecodedToken } from '../api/auth';
import { TOKEN_STORAGE_KEY } from '../api/client';

interface AuthContextValue {
  token: string | null;
  decoded: DecodedToken | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
    setToken(result.token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
  }, []);

  const decoded = token ? decodeToken(token) : null;

  return (
    <AuthContext.Provider value={{ token, decoded, isAuthenticated: Boolean(token), login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

- [ ] **Step 2: Write `frontend/src/components/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 3: Write `frontend/src/components/AdminRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function AdminRoute() {
  const { decoded } = useAuth();
  if (!decoded?.isAdmin) {
    return <Navigate to="/my-tasks" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 4: Write `frontend/src/pages/LoginPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/my-tasks');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Sign in</h1>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <label className="mb-3 block text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="mb-6 block text-sm">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors (this task's components aren't wired into `App.tsx` yet, but must still type-check standalone).

- [ ] **Step 6: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/context/AuthContext.tsx frontend/src/components/ProtectedRoute.tsx frontend/src/components/AdminRoute.tsx frontend/src/pages/LoginPage.tsx
git commit -m "feat: add auth context, route guards, and login page"
```

---

## Task 4: Routing skeleton, layout, and stub pages for every planned route

**Files:**
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/pages/MyTasksPage.tsx` (stub — populated in a later phase)
- Create: `frontend/src/pages/NewInstancePage.tsx` (stub)
- Create: `frontend/src/pages/InstanceDetailPage.tsx` (stub)
- Create: `frontend/src/pages/admin/TemplateFilesPage.tsx` (stub)
- Create: `frontend/src/pages/admin/TemplateFileDetailPage.tsx` (stub)
- Create: `frontend/src/pages/admin/WorkflowTemplatesPage.tsx` (stub)
- Create: `frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx` (stub)
- Create: `frontend/src/pages/admin/DocumentTypesPage.tsx` (stub)
- Create: `frontend/src/pages/admin/AdminInstancesPage.tsx` (stub)
- Modify: `frontend/src/App.tsx` (full router config, `QueryClientProvider`, `AuthProvider`)

**Interfaces:**
- Consumes: `AuthProvider`, `ProtectedRoute`, `AdminRoute`, `LoginPage`, `useAuth` (Task 3).
- Produces: every route this frontend build will ever have, navigable end to end (stub pages just render a heading for now). Later feature-area phases replace each stub's body — the route and nav entry already exist, so those phases touch one file each instead of also wiring routing.

- [ ] **Step 1: Write `frontend/src/components/Layout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm ${isActive ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`;

export function Layout() {
  const { decoded, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="mr-4 font-bold text-gray-900">Workflow Engine</span>
          <NavLink to="/my-tasks" className={linkClass}>
            My Tasks
          </NavLink>
          <NavLink to="/instances/new" className={linkClass}>
            Start Document
          </NavLink>
          {decoded?.isAdmin && (
            <>
              <NavLink to="/admin/template-files" className={linkClass}>
                Templates
              </NavLink>
              <NavLink to="/admin/workflow-templates" className={linkClass}>
                Workflows
              </NavLink>
              <NavLink to="/admin/document-types" className={linkClass}>
                Document Types
              </NavLink>
              <NavLink to="/admin/instances" className={linkClass}>
                All Instances
              </NavLink>
            </>
          )}
        </div>
        <button onClick={logout} className="text-sm text-gray-600 hover:text-gray-900">
          Sign out
        </button>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write the stub pages**

Each of these files follows the same one-line pattern — for example `frontend/src/pages/MyTasksPage.tsx`:
```tsx
export function MyTasksPage() {
  return <h1 className="text-xl font-bold">My Tasks</h1>;
}
```

Create the rest identically, changing only the export name and heading text:
- `frontend/src/pages/NewInstancePage.tsx` → `NewInstancePage`, "Start a Document"
- `frontend/src/pages/InstanceDetailPage.tsx` → `InstanceDetailPage`, "Instance Detail"
- `frontend/src/pages/admin/TemplateFilesPage.tsx` → `TemplateFilesPage`, "Template Files"
- `frontend/src/pages/admin/TemplateFileDetailPage.tsx` → `TemplateFileDetailPage`, "Template File Detail"
- `frontend/src/pages/admin/WorkflowTemplatesPage.tsx` → `WorkflowTemplatesPage`, "Workflow Templates"
- `frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx` → `WorkflowTemplateDetailPage`, "Workflow Template Detail"
- `frontend/src/pages/admin/DocumentTypesPage.tsx` → `DocumentTypesPage`, "Document Types"
- `frontend/src/pages/admin/AdminInstancesPage.tsx` → `AdminInstancesPage`, "All Instances"

- [ ] **Step 3: Rewrite `frontend/src/App.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { NewInstancePage } from './pages/NewInstancePage';
import { InstanceDetailPage } from './pages/InstanceDetailPage';
import { TemplateFilesPage } from './pages/admin/TemplateFilesPage';
import { TemplateFileDetailPage } from './pages/admin/TemplateFileDetailPage';
import { WorkflowTemplatesPage } from './pages/admin/WorkflowTemplatesPage';
import { WorkflowTemplateDetailPage } from './pages/admin/WorkflowTemplateDetailPage';
import { DocumentTypesPage } from './pages/admin/DocumentTypesPage';
import { AdminInstancesPage } from './pages/admin/AdminInstancesPage';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/instances/new" element={<NewInstancePage />} />
                <Route path="/instances/:id" element={<InstanceDetailPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin/template-files" element={<TemplateFilesPage />} />
                  <Route path="/admin/template-files/:id" element={<TemplateFileDetailPage />} />
                  <Route path="/admin/workflow-templates" element={<WorkflowTemplatesPage />} />
                  <Route path="/admin/workflow-templates/:id" element={<WorkflowTemplateDetailPage />} />
                  <Route path="/admin/document-types" element={<DocumentTypesPage />} />
                  <Route path="/admin/instances" element={<AdminInstancesPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/my-tasks" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
```

- [ ] **Step 4: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Verify the login flow live, end to end**

With the backend running (`docker compose up -d postgres`, `npm run migrate`, `npm run seed`, `npm run dev` in `backend/`) and the frontend dev server running (`npm run dev` in `frontend/`):

```bash
curl -s http://localhost:5173/ -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

Since no browser-automation tool is available in this environment, full interactive click-through verification (submitting the login form, watching the redirect, confirming the nav) cannot be performed by the agent — report this honestly rather than claiming it was checked. What **is** verified: the build compiles cleanly, the dev server serves the app, and the exact API call the login form makes succeeds against the real backend:

```bash
curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}'
```
Expected: `200` with a `token` field — proving the login form's request/response contract is correct.

- [ ] **Step 6: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/components/Layout.tsx frontend/src/pages/ frontend/src/App.tsx
git commit -m "feat: add routing skeleton, layout, and stub pages for every planned route"
```

## Frontend Phase 1 Exit Criteria

- [ ] `npm run build` succeeds with no TypeScript errors.
- [ ] The dev server serves the app at `/`.
- [ ] `/login` is reachable unauthenticated; every other route redirects to `/login` without a token.
- [ ] `/admin/*` routes are hidden from a non-admin token (verified once real data exists in a later phase — for now, the guard component itself is in place and unit-verifiable by reading the code).
- [ ] The login form's underlying API call is proven correct against the real running backend.
