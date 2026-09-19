import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NotificationCenter } from './NotificationCenter';

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
              <NavLink to="/admin/groups" className={linkClass}>
                Groups
              </NavLink>
              <NavLink to="/admin/users" className={linkClass}>
                Users
              </NavLink>
              <NavLink to="/admin/analytics" className={linkClass}>
                Analytics
              </NavLink>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <NotificationCenter />
          <div className="h-4 w-px bg-gray-200"></div>
          <button onClick={logout} className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            Sign out
          </button>
        </div>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
