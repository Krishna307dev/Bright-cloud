import { useEffect } from 'react';

/**
 * Sets the document title for the current route and restores it on unmount.
 * @param subtitle Optional page subtitle (e.g. "Files" -> "Files · Bright Cloud")
 */
export function usePageTitle(subtitle?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = subtitle ? `${subtitle} · Bright Cloud` : 'Bright Cloud';
    return () => {
      document.title = prevTitle;
    };
  }, [subtitle]);
}
