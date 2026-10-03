import React, { useState } from 'react';
import { Settings, LogOut, Sun, Moon, Monitor, Camera, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme, ThemeMode } from '../../contexts/ThemeContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

import {
  PRESET_AVATARS,
  getStoredAvatar,
  setStoredAvatar,
  clearStoredAvatar,
  resizeImageToDataUrl,
} from '../../utils/avatars';

export const UserSettingsPage: React.FC = () => {
  usePageTitle('Preferences');
  const { user, role, isAdmin, logout } = useAuth();
  const { mode: currentThemeMode, setMode: setThemeMode } = useTheme();
  const toast = useToast();

  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [avatar, setAvatar] = useState<string | null>(() => getStoredAvatar());
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleSelectPreset = (dataUrl: string, label: string) => {
    setStoredAvatar(dataUrl);
    setAvatar(dataUrl);
    toast.success(`Avatar updated to ${label}`);
  };

  const handleCustomUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingAvatar(true);
      const dataUrl = await resizeImageToDataUrl(file, 128);
      setStoredAvatar(dataUrl);
      setAvatar(dataUrl);
      toast.success('Custom photo uploaded as avatar');
    } catch (err: any) {
      toast.error(`Failed to process photo: ${err.message}`);
    } finally {
      setIsProcessingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResetAvatar = () => {
    clearStoredAvatar();
    setAvatar(null);
    toast.success('Avatar reset to default account photo');
  };

  const handleSavePreferences = () => {
    toast.success('Display preferences saved locally');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Header */}
      <div className="bg-white dark:bg-[#0A0A0A] p-4 sm:p-6 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954]">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              User Preferences
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
              Personal account profile, avatars, theme, and viewing options
            </p>
          </div>
        </div>

        <Badge variant={isAdmin ? 'brand' : 'success'} size="md">
          {role}
        </Badge>
      </div>

      {/* Theme & Appearance Card */}
      <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
            Theme & Appearance
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-1">
            Choose your preferred color theme or match your device system settings automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {[
            {
              id: 'system' as ThemeMode,
              label: 'System (Default)',
              desc: 'Automatically adapts to your device OS theme',
              icon: Monitor,
            },
            {
              id: 'light' as ThemeMode,
              label: 'Light',
              desc: 'Classic bright, clean neutral interface',
              icon: Sun,
            },
            {
              id: 'dark' as ThemeMode,
              label: 'Dark (OLED)',
              desc: 'True OLED black base with restrained neutral surfaces',
              icon: Moon,
            },
          ].map((themeOption) => {
            const isSelected = currentThemeMode === themeOption.id;
            return (
              <button
                key={themeOption.id}
                type="button"
                onClick={() => {
                  setThemeMode(themeOption.id);
                  toast.success(`Theme switched to ${themeOption.label}`);
                }}
                className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-brand-500 dark:border-[#1DB954] ring-2 ring-brand-300 dark:ring-[#1DB954]/25 bg-brand-50/60 dark:bg-[#1DB954]/10'
                    : 'border-slate-200 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#333333] bg-white dark:bg-[#111111]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isSelected
                        ? 'bg-brand-500 dark:bg-[#1DB954] text-white dark:text-black font-bold'
                        : 'bg-slate-100 dark:bg-[#181818] text-slate-600 dark:text-[#8A8A8A]'
                    }`}
                  >
                    <themeOption.icon className="w-4 h-4" />
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-[#1DB954] bg-brand-100 dark:bg-[#1DB954]/20 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <div className="font-semibold text-xs text-slate-900 dark:text-[#E6E6E6] mb-1">
                  {themeOption.label}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] leading-normal">
                  {themeOption.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile & Avatar Customization Card */}
      <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
            Profile & Avatar Customization
          </h2>
          {avatar && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetAvatar}
              className="gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Avatar
            </Button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5 pt-1">
          <div className="relative group shrink-0">
            {avatar ? (
              <img
                src={avatar}
                alt="Selected Avatar"
                className="w-20 h-20 rounded-full border-2 border-brand-500 dark:border-[#1DB954] object-cover shadow-md"
              />
            ) : user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-20 h-20 rounded-full border border-slate-200 dark:border-[#242424] object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-brand-50 dark:bg-[#181818] border border-brand-200 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954] font-bold text-2xl">
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 bg-slate-900/60 dark:bg-black/70 rounded-full flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[10px] font-medium"
              title="Upload custom photo"
              disabled={isProcessingAvatar}
            >
              <Camera className="w-4 h-4 mb-0.5" />
              {isProcessingAvatar ? 'Processing...' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCustomUpload}
            />
          </div>

          <div className="space-y-1.5 flex-1">
            <div className="text-base font-bold text-slate-900 dark:text-[#E6E6E6]">
              {user?.displayName || 'Authorized User'}
            </div>
            <div className="text-xs text-slate-500 dark:text-[#8A8A8A] font-mono">
              {user?.email}
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A]">Granted Role:</span>
              <span className="font-semibold text-xs text-slate-700 dark:text-[#E6E6E6]">
                {isAdmin ? 'Vault Administrator' : 'Authorized Friend / Viewer'}
              </span>
            </div>
            <div className="pt-2 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 text-xs"
                disabled={isProcessingAvatar}
              >
                <Camera className="w-3.5 h-3.5 text-brand-500 dark:text-[#1DB954]" />
                Upload Custom Photo
              </Button>
            </div>
          </div>
        </div>

        {/* Preset Avatars Selection */}
        <div className="pt-4 border-t border-slate-100 dark:border-[#242424] space-y-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-[#1DB954]" />
            <h3 className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">Choose from Preset Avatars</h3>
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
            {PRESET_AVATARS.map((preset) => {
              const isSelected = avatar === preset.dataUrl;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.dataUrl, preset.label)}
                  className={`relative p-1 rounded-full border-2 transition-all hover:scale-105 focus:outline-none ${
                    isSelected
                      ? 'border-brand-500 dark:border-[#1DB954] ring-2 ring-brand-300 dark:ring-[#1DB954]/30 shadow-sm'
                      : 'border-slate-200 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#333333]'
                  }`}
                  title={preset.label}
                >
                  <img
                    src={preset.dataUrl}
                    alt={preset.label}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 bg-brand-600 dark:bg-[#1DB954] text-white dark:text-black rounded-full p-0.5">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-[#242424] flex justify-end">
          <Button
            variant="danger"
            size="sm"
            onClick={logout}
            className="gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Viewing Preferences */}
      <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm space-y-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
          Viewer Interface Density
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            onClick={() => setDensity('comfortable')}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              density === 'comfortable'
                ? 'border-brand-500 dark:border-[#1DB954] bg-brand-50/40 dark:bg-[#1DB954]/10 text-slate-900 dark:text-[#E6E6E6]'
                : 'border-slate-200 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#333333] bg-white dark:bg-[#111111] text-slate-600 dark:text-[#8A8A8A]'
            }`}
          >
            <div className="font-semibold text-xs mb-1">Comfortable (Default)</div>
            <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] leading-normal">
              Spacious file rows with larger touch targets, perfect for desktop and tablet browsing.
            </div>
          </div>

          <div
            onClick={() => setDensity('compact')}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              density === 'compact'
                ? 'border-brand-500 dark:border-[#1DB954] bg-brand-50/40 dark:bg-[#1DB954]/10 text-slate-900 dark:text-[#E6E6E6]'
                : 'border-slate-200 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#333333] bg-white dark:bg-[#111111] text-slate-600 dark:text-[#8A8A8A]'
            }`}
          >
            <div className="font-semibold text-xs mb-1">Compact</div>
            <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] leading-normal">
              Dense table layout displaying more files per screen, ideal for large directories.
            </div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <Button variant="primary" size="sm" onClick={handleSavePreferences}>
            Save Preferences
          </Button>
        </div>
      </div>
    </div>
  );
};
