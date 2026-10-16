import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  RotateCcw,
  Save,
  Layers,
  HardDrive,
  Upload,
  Download,
  Share2,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import type { UserProfile } from '../../../models/user';
import type {
  UserCustomSettings,
  WebCustomizationConfig,
  TabVisibilityConfig,
} from '../../../models/webCustomization';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Dialog } from '../../../components/ui/Dialog';
import { useToast } from '../../../components/ui/Toast';

interface UserCustomizationDrawerProps {
  user: UserProfile | null;
  globalConfig: WebCustomizationConfig;
  availableDrives: { sourceId: string; displayName: string }[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (targetUid: string, overrides: Partial<UserCustomSettings>, targetEmail: string) => Promise<void>;
  onReset: (targetUid: string, targetEmail: string) => Promise<void>;
}

export const UserCustomizationDrawer: React.FC<UserCustomizationDrawerProps> = ({
  user,
  globalConfig,
  availableDrives,
  isOpen,
  onClose,
  onSave,
  onReset,
}) => {
  const toast = useToast();

  const [form, setForm] = useState<UserCustomSettings>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  useEffect(() => {
    if (user?.customSettings) {
      setForm(user.customSettings);
    } else {
      setForm({});
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const handleToggleTab = (tabKey: keyof TabVisibilityConfig) => {
    setForm((prev) => {
      const currentTabs = prev.visibleTabs || {};
      const currentVal = currentTabs[tabKey] ?? globalConfig.visibleTabs[tabKey];
      return {
        ...prev,
        visibleTabs: {
          ...currentTabs,
          [tabKey]: !currentVal,
        },
      };
    });
  };

  const handleToggleDrive = (sourceId: string) => {
    if (sourceId === 'WEB_UPLOADS') return;
    setForm((prev) => {
      const currentAllowed = prev.allowedDrives || [];
      const exists = currentAllowed.includes(sourceId);
      const updated = exists
        ? currentAllowed.filter((id) => id !== sourceId)
        : [...currentAllowed, sourceId];
      return {
        ...prev,
        allowedDrives: updated.length === 0 ? undefined : updated,
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await onSave(user.uid, form, user.email);
      toast.success(`Custom overrides saved for ${user.displayName || user.email}`);
      onClose();
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmReset = async () => {
    try {
      setIsSaving(true);
      await onReset(user.uid, user.email);
      setForm({});
      setIsResetConfirmOpen(false);
      toast.success(`Overrides reset to global for ${user.displayName || user.email}`);
      onClose();
    } catch (err: any) {
      toast.error(`Reset failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 dark:bg-black/60 backdrop-blur-2xs transition-opacity animate-fadeIn"
        onClick={onClose}
      />

      {/* Slide-out Drawer */}
      <div className="relative w-full max-w-lg bg-white dark:bg-[#0A0A0A] border-l border-slate-200 dark:border-[#242424] h-full shadow-2xl flex flex-col z-10 animate-slideLeft">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-[#242424] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#181818] border border-slate-200 dark:border-[#282828] flex items-center justify-center text-slate-700 dark:text-[#E6E6E6]">
              <Sliders className="w-4 h-4 text-brand-600 dark:text-[#1DB954]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] truncate">
                User Overrides: {user.displayName || user.email}
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-[#8A8A8A] truncate">
                UID: {user.uid}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-xs">
          {/* Inherited vs Overridden notice */}
          <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/80 dark:border-[#242424] text-[11px] text-slate-500 dark:text-[#8A8A8A]">
            Settings left empty or unchecked inherit directly from the <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">Global Website Customization</span>.
          </div>

          {/* Section 1: Visible Tabs Override */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                Navigation Tabs Visibility
              </span>
              <span className="text-[10px] text-slate-400">
                {form.visibleTabs ? 'Custom override' : 'Inheriting global'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: 'explorer', label: 'Explorer' },
                  { key: 'shared', label: 'Shared' },
                  { key: 'sources', label: 'USB Sources' },
                  { key: 'activity', label: 'Activity' },
                  { key: 'preferences', label: 'Preferences' },
                ] as const
              ).map((t) => {
                const isOverridden = form.visibleTabs?.[t.key] !== undefined;
                const effectiveValue = form.visibleTabs?.[t.key] ?? globalConfig.visibleTabs[t.key];

                return (
                  <label
                    key={t.key}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-[#121212] border border-slate-200/80 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#181818]"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={effectiveValue}
                        onChange={() => handleToggleTab(t.key)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="font-medium text-slate-700 dark:text-[#E6E6E6]">
                        {t.label}
                      </span>
                    </div>

                    <span className="text-[9px] px-1 rounded text-slate-400 font-mono">
                      {isOverridden ? 'Overridden' : 'Global'}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section 2: Allowed Storage Drives */}
          <div className="pt-3 border-t border-slate-100 dark:border-[#1E1E1E]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                Allowed Storage Drives
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {form.allowedDrives?.filter((id) => id !== 'WEB_UPLOADS').length
                  ? `${form.allowedDrives.filter((id) => id !== 'WEB_UPLOADS').length} USB drive(s) granted`
                  : 'Web Uploads only'}
              </span>
            </div>

            {/* Permanent Web Uploads Virtual Drive */}
            <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-[#121212] border border-emerald-200/80 dark:border-[#242424] mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled={true}
                    className="rounded border-slate-300 text-brand-600 opacity-80 cursor-not-allowed"
                  />
                  <span className="font-semibold text-slate-900 dark:text-[#E6E6E6]">
                    Web Uploads Drive
                  </span>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Always Allowed
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-[#8A8A8A] mt-1 pl-6">
                Virtual web upload drive is accessible to all authorized vault members.
              </p>
            </div>

            {/* Physical USB & Pendrive Storage Drives */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC]">
                  Physical USB & Pendrive Storage Drives
                </span>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-[#8A8A8A] mb-2">
                USB pendrive sources are restricted by default. Check a drive below to grant access to this user. Any new pendrive connected in the future will only be accessible to users you grant permission to here.
              </p>

              {availableDrives.filter((d) => d.sourceId !== 'WEB_UPLOADS').length === 0 ? (
                <div className="p-3 bg-slate-50 dark:bg-[#121212] rounded-lg border border-slate-200/80 dark:border-[#242424] text-[11px] text-slate-500 dark:text-[#8A8A8A] text-center">
                  No physical USB pendrives registered yet. When a pendrive is backed up from the Android app, it will appear here so you can grant access.
                </div>
              ) : (
                availableDrives
                  .filter((d) => d.sourceId !== 'WEB_UPLOADS')
                  .map((d) => {
                    const isChecked = form.allowedDrives ? form.allowedDrives.includes(d.sourceId) : false;
                    return (
                      <label
                        key={d.sourceId}
                        className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-brand-50/50 dark:bg-[#141414] border-brand-200 dark:border-[#1DB954]/40'
                            : 'bg-slate-50 dark:bg-[#121212] border-slate-200/80 dark:border-[#242424] hover:bg-slate-100 dark:hover:bg-[#181818]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleDrive(d.sourceId)}
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <div>
                            <span className="font-medium text-slate-800 dark:text-[#E6E6E6] block">
                              {d.displayName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              ID: {d.sourceId}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            isChecked
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-[#1C1C1C] text-slate-500 dark:text-[#8A8A8A]'
                          }`}
                        >
                          {isChecked ? 'Access Granted' : 'Restricted (Default)'}
                        </span>
                      </label>
                    );
                  })
              )}
            </div>
          </div>

          {/* Section 3: Permission Overrides */}
          <div className="pt-3 border-t border-slate-100 dark:border-[#1E1E1E] space-y-2.5">
            <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] block mb-1">
              File Operations Permissions
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Can Upload */}
              <div className="p-2.5 bg-slate-50 dark:bg-[#121212] rounded-lg border border-slate-200/80 dark:border-[#242424]">
                <label className="flex items-center gap-2 cursor-pointer mb-1">
                  <input
                    type="checkbox"
                    checked={form.canUpload ?? globalConfig.uploadRules.allowWebUploads}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, canUpload: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1">
                    <Upload className="w-3 h-3 text-brand-600 dark:text-[#1DB954]" />
                    Upload
                  </span>
                </label>
                <span className="text-[9px] text-slate-400 block font-mono">
                  {form.canUpload !== undefined
                    ? (form.canUpload ? 'User override (Granted)' : 'User override (Denied)')
                    : (globalConfig.uploadRules.allowWebUploads ? 'Inheriting global (Allowed)' : 'Default (Denied)')}
                </span>
              </div>

              {/* Can Download */}
              <div className="p-2.5 bg-slate-50 dark:bg-[#121212] rounded-lg border border-slate-200/80 dark:border-[#242424]">
                <label className="flex items-center gap-2 cursor-pointer mb-1">
                  <input
                    type="checkbox"
                    checked={form.canDownload ?? globalConfig.downloadRules.allowDownloads}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, canDownload: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1">
                    <Download className="w-3 h-3 text-brand-600 dark:text-[#1DB954]" />
                    Download
                  </span>
                </label>
                <span className="text-[9px] text-slate-400 block font-mono">
                  {form.canDownload !== undefined ? 'User override' : 'Inheriting global'}
                </span>
              </div>

              {/* Can Share */}
              <div className="p-2.5 bg-slate-50 dark:bg-[#121212] rounded-lg border border-slate-200/80 dark:border-[#242424]">
                <label className="flex items-center gap-2 cursor-pointer mb-1">
                  <input
                    type="checkbox"
                    checked={form.canShare ?? globalConfig.downloadRules.allowShareLinks}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, canShare: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1">
                    <Share2 className="w-3 h-3 text-brand-600 dark:text-[#1DB954]" />
                    Share
                  </span>
                </label>
                <span className="text-[9px] text-slate-400 block font-mono">
                  {form.canShare !== undefined ? 'User override' : 'Inheriting global'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Theme Lock & Storage Limit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-[#1E1E1E]">
            <div>
              <label className="block font-semibold text-slate-800 dark:text-[#E6E6E6] mb-1">
                Theme Lock
              </label>
              <select
                value={form.themeLock || ''}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    themeLock: (e.target.value as any) || undefined,
                  }))
                }
                className="text-xs h-8 px-2 rounded-lg bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#282828] text-slate-800 dark:text-[#E6E6E6] focus:outline-none focus:ring-1 focus:ring-brand-500 w-full"
              >
                <option value="">Inherit global ({globalConfig.defaultTheme})</option>
                <option value="dark">Force Dark Mode</option>
                <option value="light">Force Light Mode</option>
                <option value="system">Follow System</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-800 dark:text-[#E6E6E6] mb-1">
                Storage Limit (MB)
              </label>
              <Input
                type="number"
                min={0}
                value={form.storageLimitMb ?? ''}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    storageLimitMb: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                placeholder="Unlimited (default)"
                className="text-xs h-8"
              />
            </div>
          </div>

          {/* Section 5: User-Specific Notice Banner */}
          <div className="pt-3 border-t border-slate-100 dark:border-[#1E1E1E]">
            <label className="block font-semibold text-slate-800 dark:text-[#E6E6E6] mb-1 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
              Personalized User Notice Banner
            </label>
            <Input
              type="text"
              value={form.bannerMessage || ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, bannerMessage: e.target.value }))
              }
              placeholder="Leave empty to use global banner. Text here will be shown only to this user."
              className="text-xs h-8"
            />
          </div>
        </form>

        {/* Drawer Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-[#242424] flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsResetConfirmOpen(true)}
            disabled={isSaving}
            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset to Global</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Overrides'}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Resetting User Overrides */}
      <Dialog
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        title="Reset User Overrides"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-800 dark:text-rose-200 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div>
              <p className="font-semibold">Reset to Global Settings?</p>
              <p className="mt-0.5 text-rose-700 dark:text-rose-300">
                Are you sure you want to delete all personal overrides for <span className="font-bold">{user.displayName || user.email}</span>? The user will immediately inherit the global website defaults.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsResetConfirmOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmReset}
              disabled={isSaving}
            >
              {isSaving ? 'Resetting...' : 'Confirm Reset'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
