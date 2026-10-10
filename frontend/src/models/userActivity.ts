export type UserActivityAction = 'preview' | 'download' | 'open';

export interface UserActivityEvent {
  id: string;
  userId: string;
  userDisplayName: string;
  email: string;
  vaultId: string;
  sourceId: string;
  fileId: string;
  fileName: string;
  relativePath: string;
  action: UserActivityAction;
  createdAt: Date;
  device?: string;
}

export interface LogAccessParams {
  userId: string;
  userDisplayName?: string | null;
  email?: string | null;
  vaultId: string;
  sourceId: string;
  fileId: string;
  fileName: string;
  relativePath: string;
  action: UserActivityAction;
  device?: string;
}

export type ActivityDateRange = 'today' | '7days' | '30days' | 'all';

export interface UserActivityFilterState {
  userId: string;
  action: UserActivityAction | 'all';
  sourceId: string;
  dateRange: ActivityDateRange;
  searchQuery: string;
}

export interface UserActivitySummary {
  totalEvents: number;
  activeUsersCount: number;
  mostAccessedFile: { name: string; count: number } | null;
}

export interface UserSummaryRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role?: string;
  lastActive: Date | null;
  lastLogin?: Date | null;
  createdAt?: Date | null;
  previewCount: number;
  downloadCount: number;
  openCount: number;
  totalCount: number;
  recentEvents: UserActivityEvent[];
}
