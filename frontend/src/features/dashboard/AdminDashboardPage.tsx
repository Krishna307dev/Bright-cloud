import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  RefreshCw,
  Layers,
  Activity,
  Users,
  Palette,
  ShieldAlert,
} from 'lucide-react';
import {
  collection,
  getAggregateFromServer,
  sum,
  count,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../auth/AuthContext';
import { useWebCustomization } from '../../contexts/WebCustomizationContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast } from '../../components/ui/Toast';
import { VaultService } from '../../services/firestore/vaultService';
import { ApprovalService } from '../../services/firestore/approvalService';
import { SourceService } from '../../services/firestore/sourceService';
import { ActivityService } from '../../services/firestore/activityService';
import { AdminAuditService } from '../../services/firestore/adminAuditService';

import type { UserProfile, UserRole, ApprovalRequest, SourceEntity } from '../../models';
import type { UserActivityEvent } from '../../models/userActivity';
import type { AdminAuditRecord } from '../../models/webCustomization';

import { DashboardOverviewStrip, type OverviewMetrics } from './components/DashboardOverviewStrip';
import { PendingApprovalsSection } from './components/PendingApprovalsSection';
import { RecentActivitySection } from './components/RecentActivitySection';
import { UsersQuickTableSection } from './components/UsersQuickTableSection';
import { GlobalCustomizationSection } from './components/GlobalCustomizationSection';
import { UserCustomizationDrawer } from './components/UserCustomizationDrawer';
import { DrivesStorageSection, type DriveStorageTelemetry } from './components/DrivesStorageSection';
import { AdminAuditLogSection } from './components/AdminAuditLogSection';
import { Button } from '../../components/ui/Button';

export const AdminDashboardPage: React.FC = () => {
  usePageTitle('Admin Dashboard');
  const { vaultId, user } = useAuth();
  const {
    globalConfig,
    updateGlobalConfig,
    resetGlobalConfig,
    updateUserOverrides,
    resetUserOverrides,
    setUserSuspended,
  } = useWebCustomization();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Core Data
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [sources, setSources] = useState<SourceEntity[]>([]);
  const [recentEvents, setRecentEvents] = useState<UserActivityEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditRecord[]>([]);

  // Telemetry Aggregations
  const [totalFiles, setTotalFiles] = useState(0);
  const [storageBytes, setStorageBytes] = useState(0);
  const [drivesTelemetry, setDrivesTelemetry] = useState<DriveStorageTelemetry[]>([]);

  // User Customization Drawer state
  const [customizingUser, setCustomizingUser] = useState<UserProfile | null>(null);

  const loadDashboardData = useCallback(async (isSilent = false) => {
    if (!vaultId) return;

    if (!isSilent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      // 1. Fetch Users, Approvals, Sources, Recent Activity, and Audit Logs in parallel
      const [userList, approvalMap, sourceList, recentAct, recentAudit] = await Promise.all([
        VaultService.listUsers(vaultId),
        ApprovalService.listApprovalRequests(),
        SourceService.listSources(vaultId),
        ActivityService.getUserActivity(vaultId, 12),
        AdminAuditService.listRecentAuditLogs(vaultId, 50),
      ]);

      setUsers(userList);
      setSources(sourceList);
      setRecentEvents(recentAct.events);
      setAuditLogs(recentAudit);

      // Extract pending requests
      const pendingList: ApprovalRequest[] = [];
      for (const req of approvalMap.values()) {
        if (req.status === 'pending') {
          pendingList.push(req);
        }
      }
      setPendingRequests(pendingList);

      // 2. Fetch server-side aggregate totals (files & bytes)
      let aggregatedFiles = 0;
      let aggregatedBytes = 0;

      try {
        const filesCol = collection(db, 'vaults', vaultId, 'files');
        const aggSnap = await getAggregateFromServer(filesCol, {
          totalCount: count(),
          totalSize: sum('size'),
        });
        aggregatedFiles = aggSnap.data().totalCount || 0;
        aggregatedBytes = aggSnap.data().totalSize || 0;
      } catch (err) {
        console.warn('Dashboard: getAggregateFromServer failed, falling back to source totals:', err);
        aggregatedFiles = sourceList.reduce((acc, s) => acc + (s.totalFilesBackedUp || 0), 0);
      }

      setTotalFiles(aggregatedFiles);
      setStorageBytes(aggregatedBytes);

      // 3. Compute per-drive telemetry
      const driveSummaries: DriveStorageTelemetry[] = sourceList.map((src) => {
        return {
          source: src,
          fileCount: src.totalFilesBackedUp || 0,
          totalBytes: 0, // Server sum per source or estimated proportion
          lastActivity: src.lastSeen,
        };
      });

      // Distribute storage proportionally across drives if file count exists
      if (aggregatedBytes > 0 && aggregatedFiles > 0) {
        for (const ds of driveSummaries) {
          if (ds.fileCount > 0) {
            ds.totalBytes = Math.round((ds.fileCount / aggregatedFiles) * aggregatedBytes);
          }
        }
      }

      setDrivesTelemetry(driveSummaries);
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      toast.error(`Dashboard load error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [vaultId, toast]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Top Metrics Calculation
  const metrics: OverviewMetrics = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const activeUsers7d = users.filter((u) => u.lastLogin && u.lastLogin.getTime() >= sevenDaysAgo).length;

    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const onlineSources = sources.filter(
      (s) => s.status === 'ACTIVE' && s.lastSeen && s.lastSeen.getTime() >= oneDayAgo
    ).length;
    const offlineSources = Math.max(0, sources.length - onlineSources);

    return {
      totalUsers: users.length,
      pendingApprovals: pendingRequests.length,
      activeUsers7d,
      totalFiles,
      storageBytes,
      onlineSources,
      offlineSources,
      isLoading,
    };
  }, [users, pendingRequests.length, sources, totalFiles, storageBytes, isLoading]);

  // Actions
  const handleApproveRequest = async (req: ApprovalRequest) => {
    if (!vaultId) return;
    try {
      await ApprovalService.updateApprovalStatus(req.uid, 'approved');
      await VaultService.setUserRole(vaultId, req.uid, 'friend');

      if (user?.uid) {
        await AdminAuditService.logAction(vaultId, {
          adminUid: user.uid,
          adminEmail: user.email || 'admin',
          action: 'APPROVE_USER',
          targetUid: req.uid,
          targetEmail: req.email,
          details: `Approved vault friend access for ${req.name} (${req.email})`,
        });
      }

      toast.success(`Access approved for ${req.name}`);
      await loadDashboardData(true);
    } catch (err: any) {
      toast.error(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectRequest = async (req: ApprovalRequest) => {
    if (!vaultId) return;
    try {
      await ApprovalService.updateApprovalStatus(req.uid, 'rejected');

      if (user?.uid) {
        await AdminAuditService.logAction(vaultId, {
          adminUid: user.uid,
          adminEmail: user.email || 'admin',
          action: 'REJECT_USER',
          targetUid: req.uid,
          targetEmail: req.email,
          details: `Rejected access request for ${req.name} (${req.email})`,
        });
      }

      toast.success(`Access rejected for ${req.name}`);
      await loadDashboardData(true);
    } catch (err: any) {
      toast.error(`Rejection failed: ${err.message}`);
    }
  };

  const handleRoleChange = async (targetUid: string, newRole: UserRole) => {
    if (!vaultId) return;
    try {
      await VaultService.setUserRole(vaultId, targetUid, newRole);

      if (user?.uid) {
        await AdminAuditService.logAction(vaultId, {
          adminUid: user.uid,
          adminEmail: user.email || 'admin',
          action: 'CHANGE_USER_ROLE',
          targetUid,
          details: `Changed role of user ${targetUid} to ${newRole}`,
        });
      }

      toast.success(`User role updated to ${newRole}`);
      await loadDashboardData(true);
    } catch (err: any) {
      toast.error(`Role change failed: ${err.message}`);
    }
  };

  const handleToggleSuspend = async (targetUid: string, isSuspended: boolean, email: string) => {
    try {
      await setUserSuspended(targetUid, isSuspended, email);
      toast.success(`User ${isSuspended ? 'suspended' : 'activated'}`);
      await loadDashboardData(true);
    } catch (err: any) {
      toast.error(`Action failed: ${err.message}`);
    }
  };

  // Active Domain Tab
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const validTabs = ['all', 'overview', 'users', 'customization', 'audit'] as const;
  type DashboardTab = (typeof validTabs)[number];
  const initialTab: DashboardTab = validTabs.includes(rawTab as any) ? (rawTab as DashboardTab) : 'all';
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);

  const handleTabChange = (tab: DashboardTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'all') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  };

  const availableDrivesList = useMemo(() => {
    const list = sources.map((s) => ({
      sourceId: s.sourceId,
      displayName: s.sourceId === 'WEB_UPLOADS' ? 'Web Uploads' : (s.displayName || s.sourceId),
    }));
    if (!list.some((d) => d.sourceId === 'WEB_UPLOADS')) {
      list.unshift({ sourceId: 'WEB_UPLOADS', displayName: 'Web Uploads' });
    }
    return list;
  }, [sources]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fadeIn pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-[#242424] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954] shrink-0">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
                Dashboard
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-50 dark:bg-[#1DB954]/15 text-brand-600 dark:text-[#1DB954] border border-brand-200/60 dark:border-[#1DB954]/30 uppercase tracking-wider">
                Admin Control Center
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-0.5">
              High-level vault telemetry, active approvals, and live website governance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadDashboardData(true)}
            disabled={isLoading || isRefreshing}
            className="text-xs text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6] gap-1.5 h-8 px-3"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isRefreshing ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''
              }`}
            />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Domain Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#111111] p-1 rounded-lg border border-slate-200 dark:border-[#242424] w-fit">
        <button
          type="button"
          onClick={() => handleTabChange('all')}
          className={`min-h-[34px] px-3.5 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'all'
              ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
              : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Sections</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('overview')}
          className={`min-h-[34px] px-3.5 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
              : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Overview & Telemetry</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('users')}
          className={`min-h-[34px] px-3.5 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'users'
              ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
              : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Users & Overrides</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('customization')}
          className={`min-h-[34px] px-3.5 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'customization'
              ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
              : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Website Customization</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('audit')}
          className={`min-h-[34px] px-3.5 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
              : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Audit Log</span>
        </button>
      </div>

      {/* Section A: Overview Metrics Strip */}
      {(activeTab === 'all' || activeTab === 'overview') && (
        <DashboardOverviewStrip metrics={metrics} />
      )}

      {/* Section B: Pending Approvals (Rendered if requests exist) */}
      {(activeTab === 'all' || activeTab === 'overview' || activeTab === 'users') && pendingRequests.length > 0 && (
        <PendingApprovalsSection
          requests={pendingRequests}
          onApprove={handleApproveRequest}
          onReject={handleRejectRequest}
        />
      )}

      {/* Section C & G: Recent Activity Feed & Drives Storage Overview side-by-side */}
      {(activeTab === 'all' || activeTab === 'overview') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <RecentActivitySection
            events={recentEvents}
            isLoading={isLoading}
          />
          <DrivesStorageSection
            drives={drivesTelemetry}
            totalVaultBytes={storageBytes}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Section D: Users Quick Control Table (FULL WIDTH) */}
      {(activeTab === 'all' || activeTab === 'users') && (
        <div className="w-full">
          <UsersQuickTableSection
            users={users}
            isLoading={isLoading}
            onRoleChange={handleRoleChange}
            onToggleSuspend={handleToggleSuspend}
            onOpenCustomize={(u) => setCustomizingUser(u)}
          />
        </div>
      )}

      {/* Section E: Website Customization (Global) (FULL WIDTH) */}
      {(activeTab === 'all' || activeTab === 'customization') && (
        <div className="w-full">
          <GlobalCustomizationSection
            config={globalConfig}
            onSave={updateGlobalConfig}
            onReset={resetGlobalConfig}
            availableDrives={availableDrivesList}
          />
        </div>
      )}

      {/* Section H: Admin Action Audit Log (FULL WIDTH) */}
      {(activeTab === 'all' || activeTab === 'audit') && (
        <div className="w-full">
          <AdminAuditLogSection
            logs={auditLogs}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Section F: Individual User Customization Drawer */}
      <UserCustomizationDrawer
        user={customizingUser}
        globalConfig={globalConfig}
        availableDrives={availableDrivesList}
        isOpen={Boolean(customizingUser)}
        onClose={() => setCustomizingUser(null)}
        onSave={async (uid, overrides, email) => {
          await updateUserOverrides(uid, overrides, email);
          await loadDashboardData(true);
        }}
        onReset={async (uid, email) => {
          await resetUserOverrides(uid, email);
          await loadDashboardData(true);
        }}
      />
    </div>
  );
};

export default AdminDashboardPage;
