import React, { useState, useEffect } from 'react';
import {
  Palette,
  Upload,
  Download,
  AlertTriangle,
  RotateCcw,
  Check,
  Save,
  Bell,
  Sun,
  Moon,
  Monitor,
  ShieldAlert,
} from 'lucide-react';
import type {
  WebCustomizationConfig,
  AccentColor,
  ThemePreference,
} from '../../../models/webCustomization';
import { DEFAULT_WEB_CONFIG } from '../../../models/webCustomization';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Dialog } from '../../../components/ui/Dialog';
import { useToast } from '../../../components/ui/Toast';

interface GlobalCustomizationSectionProps {
  config: WebCustomizationConfig;
  onSave: (updates: Partial<WebCustomizationConfig>) => Promise<void>;
  onReset: () => Promise<void>;
  availableDrives: { sourceId: string; displayName: string }[];
}

const ACCENT_PALETTE: { id: AccentColor; name: string; hex: string; bgClass: string }[] = [
  { id: 'emerald', name: 'Emerald', hex: '#1DB954', bgClass: 'bg-[#1DB954]' },
  { id: 'blue', name: 'Ocean Blue', hex: '#3B82F6', bgClass: 'bg-blue-500' },
  { id: 'amber', name: 'Warm Amber', hex: '#F59E0B', bgClass: 'bg-amber-500' },
  { id: 'indigo', name: 'Indigo', hex: '#6366F1', bgClass: 'bg-indigo-500' },
  { id: 'violet', name: 'Violet', hex: '#8B5CF6', bgClass: 'bg-violet-500' },
  { id: 'neutral', name: 'Neutral Slate', hex: '#64748B', bgClass: 'bg-slate-500' },
];

export const GlobalCustomizationSection: React.FC<GlobalCustomizationSectionProps> = ({
  config,
  onSave,
  onReset,
  availableDrives,
}) => {
  const toast = useToast();

  const [form, setForm] = useState<WebCustomizationConfig>(config);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isMaintenanceDialogOpen, setIsMaintenanceDialogOpen] = useState(false);

  // Sync state when config changes from server
  useEffect(() => {
    setForm(config);
  }, [config]);

  const handleAccentChange = (accent: AccentColor) => {
    setForm((prev) => ({ ...prev, accentColor: accent }));
  };

  const handleThemeChange = (theme: ThemePreference) => {
    setForm((prev) => ({ ...prev, defaultTheme: theme }));
  };

  const handleTabToggle = (tabKey: keyof typeof config.visibleTabs) => {
    setForm((prev) => ({
      ...prev,
      visibleTabs: {
        ...prev.visibleTabs,
        [tabKey]: !prev.visibleTabs[tabKey],
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await onSave(form);
      toast.success('Website customization saved live');
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmReset = async () => {
    try {
      setIsSaving(true);
      await onReset();
      setForm(DEFAULT_WEB_CONFIG);
      setIsResetDialogOpen(false);
      toast.success('Website customization reset to defaults');
    } catch (err: any) {
      toast.error(`Reset failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleMaintenanceMode = () => {
    if (!form.maintenanceMode) {
      // Prompt before turning ON maintenance mode
      setIsMaintenanceDialogOpen(true);
    } else {
      // Turning OFF
      setForm((prev) => ({ ...prev, maintenanceMode: false }));
    }
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-4">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-brand-600 dark:text-[#1DB954]" />
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Website Customization (Global)
            </h2>
            <p className="text-[11px] text-slate-400 dark:text-[#8A8A8A]">
              Controls branding, visible tabs, upload/download limits, and maintenance for normal users.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsResetDialogOpen(true)}
            disabled={isSaving}
            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1 h-8"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset to defaults</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={isSaving}
            className="text-xs gap-1.5 h-8 px-3"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Apply Live'}</span>
          </Button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 text-xs">
        {/* Row 1: Site Branding & Accent */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Site Title / Name
            </label>
            <Input
              type="text"
              value={form.siteName}
              onChange={(e) => setForm((prev) => ({ ...prev, siteName: e.target.value }))}
              placeholder="Bright Cloud"
              className="text-xs h-8"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Custom Logo Image URL (Optional)
            </label>
            <Input
              type="text"
              value={form.logoUrl || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, logoUrl: e.target.value }))}
              placeholder="https://... or data:image/..."
              className="text-xs h-8"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Accent Color Palette
            </label>
            <div className="flex items-center gap-2 pt-1">
              {ACCENT_PALETTE.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => handleAccentChange(acc.id)}
                  className={`w-6 h-6 rounded-full ${acc.bgClass} flex items-center justify-center transition-transform ${
                    form.accentColor === acc.id
                      ? 'ring-2 ring-offset-2 ring-slate-800 dark:ring-white scale-110'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  title={acc.name}
                >
                  {form.accentColor === acc.id && (
                    <Check className="w-3 h-3 text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Default Theme & Landing Drive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-[#1E1E1E]">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Default Theme for New Users
            </label>
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-[#121212] p-1 rounded-lg border border-slate-200 dark:border-[#282828] w-fit">
              <button
                type="button"
                onClick={() => handleThemeChange('dark')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                  form.defaultTheme === 'dark'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-semibold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Moon className="w-3 h-3" />
                Dark
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('light')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                  form.defaultTheme === 'light'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-semibold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sun className="w-3 h-3" />
                Light
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('system')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                  form.defaultTheme === 'system'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-semibold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Monitor className="w-3 h-3" />
                System
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Default Landing Drive
            </label>
            <select
              value={form.defaultLandingDrive || 'auto'}
              onChange={(e) => setForm((prev) => ({ ...prev, defaultLandingDrive: e.target.value }))}
              className="text-xs h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#282828] text-slate-800 dark:text-[#E6E6E6] focus:outline-none focus:ring-1 focus:ring-brand-500 w-full"
            >
              <option value="auto">Smart Automatic (Active / Non-empty)</option>
              {availableDrives.map((d) => (
                <option key={d.sourceId} value={d.sourceId}>
                  {d.displayName} ({d.sourceId})
                </option>
              ))}
            </select>
          </div>

          {/* Maintenance Mode Toggle */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1">
              Maintenance Mode
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={toggleMaintenanceMode}
                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  form.maintenanceMode ? 'bg-amber-500' : 'bg-slate-300 dark:bg-[#333333]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    form.maintenanceMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`text-[11px] font-semibold truncate ${form.maintenanceMode ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-[#8A8A8A]'}`}>
                {form.maintenanceMode ? 'Active (Lockout enabled)' : 'Inactive'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-[#666666] mt-1">
              Lockout non-admins with a calm maintenance notice.
            </p>
          </div>
        </div>

        {/* Row 3: Notice Banner */}
        <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/80 dark:border-[#242424] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
              <span className="text-[11px] font-semibold text-slate-800 dark:text-[#E6E6E6]">
                Top Announcement Banner
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.banner.enabled}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    banner: { ...prev.banner, enabled: e.target.checked },
                  }))
                }
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-[11px] text-slate-600 dark:text-[#8A8A8A]">
                Show Banner
              </span>
            </label>
          </div>

          {form.banner.enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="sm:col-span-2">
                <Input
                  type="text"
                  value={form.banner.text}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      banner: { ...prev.banner, text: e.target.value },
                    }))
                  }
                  placeholder="Welcome to Bright Cloud! Maintenance scheduled tonight..."
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Input
                  type="date"
                  value={
                    form.banner.expiresAt
                      ? new Date(form.banner.expiresAt).toISOString().split('T')[0]
                      : ''
                  }
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      banner: {
                        ...prev.banner,
                        expiresAt: e.target.value ? new Date(e.target.value) : null,
                      },
                    }))
                  }
                  title="Optional Banner Expiry Date"
                  className="text-xs h-8"
                />
              </div>
            </div>
          )}
        </div>

        {/* Row 4: Visible Tabs for Normal Users */}
        <div className="pt-2 border-t border-slate-100 dark:border-[#1E1E1E]">
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-[#CCCCCC] mb-1.5">
            Visible Navigation Tabs for Normal Users
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {(
              [
                { key: 'explorer', label: 'Explorer' },
                { key: 'shared', label: 'Shared' },
                { key: 'sources', label: 'USB Sources' },
                { key: 'activity', label: 'Activity' },
                { key: 'preferences', label: 'Preferences' },
              ] as const
            ).map((t) => (
              <label
                key={t.key}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-[#121212] border border-slate-200/80 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={form.visibleTabs[t.key]}
                  onChange={() => handleTabToggle(t.key)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-[11px] font-medium text-slate-700 dark:text-[#E6E6E6]">
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Row 5: Upload & Download Rules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-[#1E1E1E]">
          {/* Upload Rules */}
          <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/80 dark:border-[#242424] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                Web Upload Rules
              </span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.uploadRules.allowWebUploads}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      uploadRules: { ...prev.uploadRules, allowWebUploads: e.target.checked },
                    }))
                  }
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-[11px] text-slate-600 dark:text-[#8A8A8A]">
                  Allow Web Uploads
                </span>
              </label>
            </div>

            <div>
              <label className="block text-[10px] text-slate-400 dark:text-[#8A8A8A] mb-0.5">
                Max Upload File Size (MB)
              </label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={form.uploadRules.maxFileSizeMb}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    uploadRules: {
                      ...prev.uploadRules,
                      maxFileSizeMb: Number(e.target.value) || 500,
                    },
                  }))
                }
                className="text-xs h-7 w-28"
              />
            </div>
          </div>

          {/* Download & Share Rules */}
          <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/80 dark:border-[#242424] space-y-2">
            <span className="text-[11px] font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
              Download & Sharing Rules
            </span>

            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.downloadRules.allowDownloads}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      downloadRules: { ...prev.downloadRules, allowDownloads: e.target.checked },
                    }))
                  }
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-[11px] text-slate-600 dark:text-[#8A8A8A]">
                  Allow file downloads for normal users
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.downloadRules.allowShareLinks}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      downloadRules: { ...prev.downloadRules, allowShareLinks: e.target.checked },
                    }))
                  }
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-[11px] text-slate-600 dark:text-[#8A8A8A]">
                  Allow generating signed share links
                </span>
              </label>
            </div>
          </div>
        </div>
      </form>

      {/* Confirmation Dialog for Resetting to Defaults */}
      <Dialog
        isOpen={isResetDialogOpen}
        onClose={() => setIsResetDialogOpen(false)}
        title="Reset Customization to Defaults"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-800 dark:text-rose-200 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div>
              <p className="font-semibold">Confirm Reset Action</p>
              <p className="mt-0.5 text-rose-700 dark:text-rose-300">
                Are you sure you want to restore all website settings to standard factory defaults? Any custom title, banner, accent color, and tab configurations will be reset.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsResetDialogOpen(false)}
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
              {isSaving ? 'Resetting...' : 'Reset to Defaults'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirmation Dialog for Maintenance Mode */}
      <Dialog
        isOpen={isMaintenanceDialogOpen}
        onClose={() => setIsMaintenanceDialogOpen(false)}
        title="Enable Maintenance Mode"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg text-amber-800 dark:text-amber-200 text-xs">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold">Turn on Maintenance Lockout?</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                When maintenance mode is active, all normal users and friends will immediately see a maintenance screen. Only administrators will be able to access the vault.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsMaintenanceDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setForm((prev) => ({ ...prev, maintenanceMode: true }));
                setIsMaintenanceDialogOpen(false);
              }}
            >
              Confirm & Enable
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
