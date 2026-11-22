// App root — routing + layout
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import RekapPage from './pages/RekapPage.jsx';
import DevicesPage from './pages/DevicesPage.jsx';
import DeviceCenterPage from './pages/DeviceCenterPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import WhatsAppPage from './pages/WhatsAppPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SchedulerPage from './pages/SchedulerPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('fp_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="admin" element={<AdminDashboardPage />} />
              <Route path="attendance" element={<AttendancePage />} />
              <Route path="rekap" element={<RekapPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="device-center" element={<DeviceCenterPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="whatsapp" element={<WhatsAppPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="scheduler" element={<SchedulerPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ToastProvider>
  );
}
