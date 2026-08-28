import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function AdminRoute() {
  const { decoded } = useAuth();
  if (!decoded?.isAdmin) {
    return <Navigate to="/my-tasks" replace />;
  }
  return <Outlet />;
}
