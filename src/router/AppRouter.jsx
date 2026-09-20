import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { LoginPage } from '../pages/Login/LoginPage';
import { DashboardPage } from '../pages/Dashboard/DashboardPage';
import { SchedulePage } from '../pages/Schedule/SchedulePage';
import { GradesPage } from '../pages/Grades/GradesPage';
import { RecordbookPage } from '../pages/Recordbook/RecordbookPage';
import { ConsultationsPage } from '../pages/Consultations/ConsultationsPage';
import { SettingsPage } from '../pages/Settings/SettingsPage';
import { NotFoundPage } from '../pages/NotFound/NotFoundPage';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <LoadingSpinner size={12} text="Авторизация в системе..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export const AppRouter = () => {
  const { isAuthenticated, isLoading, isCollege } = useAuth();

  return (
    <Routes>
      {/* Public Route */}
      <Route
        path="/login"
        element={
          !isLoading && isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
        }
      />

      {/* Protected Routes inside AppShell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="grades" element={<GradesPage />} />
        <Route path="recordbook" element={<RecordbookPage />} />
        <Route
          path="consultations"
          element={isCollege ? <Navigate to="/" replace /> : <ConsultationsPage />}
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};
