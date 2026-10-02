/**
 * Error classes and classification helpers.
 */

export class PropagationAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropagationAbortedError';
  }
}

export type AuthStateCategory =
  | 'AUTHENTICATED_ADMIN'
  | 'AUTHENTICATED_FRIEND'
  | 'UNAUTHORIZED'
  | 'UNAUTHENTICATED'
  | 'NETWORK_ERROR'
  | 'VAULT_UNINITIALIZED';

export type FirebaseErrorClassification =
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'OTHER';

export function classifyFirebaseError(error: any): FirebaseErrorClassification {
  if (!error) return 'OTHER';
  const code = (typeof error.code === 'string' ? error.code : '').toLowerCase();
  const message = (
    typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
      ? error
      : ''
  ).toLowerCase();

  // Permission Denied
  if (
    code.includes('permission-denied') ||
    code.includes('unauthorized') ||
    message.includes('missing or insufficient permissions') ||
    message.includes('permission denied')
  ) {
    return 'PERMISSION_DENIED';
  }

  // Network / Unavailable / Timeout
  if (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('network-request-failed') ||
    code.includes('failed-precondition') ||
    message.includes('offline') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('network connection')
  ) {
    return 'NETWORK_ERROR';
  }

  // Unauthenticated
  if (
    code.includes('unauthenticated') ||
    code.includes('user-not-found') ||
    message.includes('unauthenticated')
  ) {
    return 'UNAUTHENTICATED';
  }

  // Not Found
  if (code.includes('not-found') || message.includes('not found')) {
    return 'NOT_FOUND';
  }

  return 'OTHER';
}
