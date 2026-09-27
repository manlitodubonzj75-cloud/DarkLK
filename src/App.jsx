import React from 'react';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SyncProvider } from './context/SyncContext';
import { AppRouter } from './router/AppRouter';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SyncProvider>
            <HashRouter>
              <AppRouter />
            </HashRouter>
          </SyncProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
