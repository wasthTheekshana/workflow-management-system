import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyTasksPage } from './pages/MyTasksPage';
import { NewInstancePage } from './pages/NewInstancePage';
import { InstanceDetailPage } from './pages/InstanceDetailPage';
import { TemplateFilesPage } from './pages/admin/TemplateFilesPage';
import { TemplateFileDetailPage } from './pages/admin/TemplateFileDetailPage';
import { WorkflowTemplatesPage } from './pages/admin/WorkflowTemplatesPage';
import { WorkflowTemplateDetailPage } from './pages/admin/WorkflowTemplateDetailPage';
import { DocumentTypesPage } from './pages/admin/DocumentTypesPage';
import { AdminInstancesPage } from './pages/admin/AdminInstancesPage';
import { GroupsPage } from './pages/admin/GroupsPage';
import { GroupDetailPage } from './pages/admin/GroupDetailPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/instances/new" element={<NewInstancePage />} />
                <Route path="/instances/:id" element={<InstanceDetailPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin/template-files" element={<TemplateFilesPage />} />
                  <Route path="/admin/template-files/:id" element={<TemplateFileDetailPage />} />
                  <Route path="/admin/workflow-templates" element={<WorkflowTemplatesPage />} />
                  <Route path="/admin/workflow-templates/:id" element={<WorkflowTemplateDetailPage />} />
                  <Route path="/admin/document-types" element={<DocumentTypesPage />} />
                  <Route path="/admin/instances" element={<AdminInstancesPage />} />
                  <Route path="/admin/groups" element={<GroupsPage />} />
                  <Route path="/admin/groups/:id" element={<GroupDetailPage />} />
                  <Route path="/admin/users" element={<UsersPage />} />
                  <Route path="/admin/analytics" element={<AnalyticsPage />} />
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
