import { sha256 } from '@noble/hashes/sha256';

/**
 * Genuinely incremental streaming SHA-256 Hasher using @noble/hashes/sha256.
 * Processes File/Blob data in bounded <= 4 MiB slices without loading the entire
 * file into memory, guaranteeing constant memory usage <= 4 MiB and providing
 * granular progress callbacks.
 */
export async function computeFileSha256(
  file: File | Blob,
  onProgress?: (percent: number) => void
): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB buffer ceiling
  const hasher = sha256.create();
  let offset = 0;
  const total = file.size;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const slice = file.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buffer));
    offset = end;

    if (onProgress && total > 0) {
      onProgress(Math.min(100, Math.round((offset / total) * 100)));
    }
  }

  const digest = hasher.digest();
  return Array.from(digest)
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Alias for computeFileSha256 conforming to the specification name.
 */
export const computeStreamingSha256 = computeFileSha256;
