/**
 * Path utilities for canonical directory representation and matching.
 * Invariant: Directory paths strictly use '/', have no leading slash, and end with a trailing '/'.
 * Root path is empty string ("").
 */

export function canonicalizePath(path: string): string {
  if (!path || path.trim() === '' || path === '/') {
    return '';
  }
  // Replace all backslashes with forward slashes
  let normalized = path.replace(/\\/g, '/');
  // Strip leading slashes
  normalized = normalized.replace(/^\/+/, '');
  // Collapse duplicate slashes
  normalized = normalized.replace(/\/+/g, '/');
  // Ensure trailing slash if non-empty
  if (normalized.length > 0 && !normalized.endsWith('/')) {
    normalized += '/';
  }
  return normalized;
}

/**
 * Checks whether a file path is a descendant of a directory path respecting directory boundaries.
 * Prevents "Documents/Pro/" matching "Documents/Projects/file.txt".
 */
export function isDescendantOf(filePath: string, folderPath: string): boolean {
  const canonicalFolder = canonicalizePath(folderPath);
  const canonicalFile = canonicalizePath(filePath);

  if (canonicalFolder === '') {
    return true; // Root matches everything
  }

  return canonicalFile.startsWith(canonicalFolder);
}

/**
 * Generates an injective, collision-safe deterministic Rule ID for a (sourceId, relativePath) pair.
 */
export function generateRuleId(sourceId: string, relativePath: string): string {
  const canonical = canonicalizePath(relativePath);
  const encodedPath = canonical === '' ? 'ROOT' : encodeURIComponent(canonical);
  return `${sourceId}__${encodedPath}`;
}

/**
 * Gets immediate parent path, or null if already at root.
 * e.g. "Documents/Projects/" -> "Documents/"
 * "Documents/" -> ""
 * "" -> null
 */
export function getParentPath(path: string): string | null {
  const canonical = canonicalizePath(path);
  if (canonical === '') return null;
  const segments = canonical.slice(0, -1).split('/');
  segments.pop();
  if (segments.length === 0) return '';
  return segments.join('/') + '/';
}

/**
 * Extracts folder name from a canonical folder path.
 * e.g. "Documents/Projects/" -> "Projects"
 * "" -> "Root"
 */
export function getFolderName(path: string): string {
  const canonical = canonicalizePath(path);
  if (canonical === '') return 'Root';
  const parts = canonical.slice(0, -1).split('/');
  return parts[parts.length - 1] || 'Root';
}

/**
 * Splits filename into base and extension (e.g. "report.pdf" -> ["report", ".pdf"]).
 */
export function splitFilename(filename: string): [string, string] {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return [filename, ''];
  return [filename.slice(0, dot), filename.slice(dot)];
}
