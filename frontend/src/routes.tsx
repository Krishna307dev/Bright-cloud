import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, AdminRoute, PublicOnlyRoute } from './features/auth/RouteGuards';
import { AppShell } from './components/layout/AppShell';

// Pages
import { LoginPage } from './features/auth/LoginPage';
import { AccessDeniedPage } from './features/auth/AccessDeniedPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { FileExplorerPage } from './features/files/FileExplorerPage';
import { SourcesPage } from './features/sources/SourcesPage';
import { SharedPage } from './features/permissions/SharedPage';
import { ManageUsersPage } from './features/users/ManageUsersPage';
import { ActivityPage } from './features/activity/ActivityPage';
import { UserSettingsPage } from './features/settings/UserSettingsPage';
import { AdminVaultSettingsPage } from './features/settings/AdminVaultSettingsPage';
import { NotFoundPage } from './features/errors/NotFoundPage';

import { ContactDeveloperPage } from './features/contact/ContactDeveloperPage';

export const router = createBrowserRouter([
  // Public-only route (redirects to / if already authenticated)
  {
    element: <PublicOnlyRoute />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
    ],
  },

  // Contact developer page (accessible to all users)
  {
    path: '/contact-developer',
    element: <ContactDeveloperPage />,
  },

  // Access denied screen (for authenticated users not in vault whitelist)
  {
    path: '/access-denied',
    element: <AccessDeniedPage />,
  },

  // Protected application routes
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            path: '/',
            element: <DashboardPage />,
          },
          {
            path: '/files',
            element: <FileExplorerPage />,
          },
          {
            path: '/files/:sourceId',
            element: <FileExplorerPage />,
          },
          {
            path: '/files/:sourceId/*',
            element: <FileExplorerPage />,
          },
          {
            path: '/sources',
            element: <SourcesPage />,
          },
          {
            path: '/shared',
            element: <SharedPage />,
          },
          {
            path: '/activity',
            element: <ActivityPage />,
          },
          {
            path: '/settings',
            element: <UserSettingsPage />,
          },

          // Admin-only routes
          {
            element: <AdminRoute />,
            children: [
              {
                path: '/friends',
                element: <Navigate to="/users" replace />,
              },
              {
                path: '/users',
                element: <ManageUsersPage />,
              },
              {
                path: '/settings/vault',
                element: <AdminVaultSettingsPage />,
              },
            ],
          },
        ],
      },
    ],
  },

  // Fallback 404 page
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
