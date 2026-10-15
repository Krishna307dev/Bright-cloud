import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './contexts/ThemeContext';
import { WebCustomizationProvider } from './contexts/WebCustomizationContext';
import { router } from './routes';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <WebCustomizationProvider>
        <ThemeProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeProvider>
      </WebCustomizationProvider>
    </AuthProvider>
  );
};

export default App;
