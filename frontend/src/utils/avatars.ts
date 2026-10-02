/**
 * Avatar presets and local user customization helpers.
 */

export interface PresetAvatar {
  id: string;
  label: string;
  dataUrl: string;
}

// Generate inline SVG data URLs for fast, reliable preset avatars without network dependencies
function createSvgAvatar(bg: string, fg: string, emojiOrIcon: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="50" fill="${bg}"/>
    <text x="50" y="55" font-size="44" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" dominant-baseline="central" text-anchor="middle" fill="${fg}">${emojiOrIcon}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  { id: 'cloud', label: 'Cloud Blue', dataUrl: createSvgAvatar('#0284c7', '#ffffff', '☁️') },
  { id: 'rocket', label: 'Cosmic Rocket', dataUrl: createSvgAvatar('#6366f1', '#ffffff', '🚀') },
  { id: 'shield', label: 'Security Shield', dataUrl: createSvgAvatar('#059669', '#ffffff', '🛡️') },
  { id: 'sparkles', label: 'Bright Star', dataUrl: createSvgAvatar('#f59e0b', '#ffffff', '✨') },
  { id: 'fire', label: 'Blaze Flame', dataUrl: createSvgAvatar('#ea580c', '#ffffff', '🔥') },
  { id: 'emerald', label: 'Emerald Leaf', dataUrl: createSvgAvatar('#10b981', '#ffffff', '🌱') },
  { id: 'gem', label: 'Purple Gem', dataUrl: createSvgAvatar('#9333ea', '#ffffff', '💎') },
  { id: 'cyber', label: 'Cyber Tech', dataUrl: createSvgAvatar('#0f172a', '#38bdf8', '⚡') },
  { id: 'solar', label: 'Golden Sun', dataUrl: createSvgAvatar('#f97316', '#ffffff', '☀️') },
  { id: 'vault', label: 'Safe Lock', dataUrl: createSvgAvatar('#334155', '#38bdf8', '🔐') },
];

const AVATAR_STORAGE_KEY = 'brightcloud_user_avatar';

export function getStoredAvatar(): string | null {
  try {
    return localStorage.getItem(AVATAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAvatar(avatarDataUrl: string): void {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, avatarDataUrl);
    window.dispatchEvent(new Event('brightcloud_avatar_updated'));
  } catch (err) {
    console.error('Failed to persist user avatar to localStorage:', err);
  }
}

export function clearStoredAvatar(): void {
  try {
    localStorage.removeItem(AVATAR_STORAGE_KEY);
    window.dispatchEvent(new Event('brightcloud_avatar_updated'));
  } catch (err) {
    console.error('Failed to clear user avatar from localStorage:', err);
  }
}

/**
 * Resizes and crops any uploaded image file to a 128x128 square DataURL.
 */
export async function resizeImageToDataUrl(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }

        // Center crop math
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image file'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
