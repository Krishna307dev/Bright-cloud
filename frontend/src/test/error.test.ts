import { describe, it, expect } from 'vitest';
import { classifyFirebaseError } from '../utils/error';

describe('Role Probe & Firebase Error Classification', () => {
  it('classifies network and unavailable errors as NETWORK_ERROR', () => {
    expect(classifyFirebaseError({ code: 'unavailable' })).toBe('NETWORK_ERROR');
    expect(classifyFirebaseError({ code: 'firestore/unavailable' })).toBe('NETWORK_ERROR');
    expect(classifyFirebaseError({ code: 'deadline-exceeded' })).toBe('NETWORK_ERROR');
    expect(classifyFirebaseError({ message: 'Failed to fetch' })).toBe('NETWORK_ERROR');
    expect(classifyFirebaseError({ message: 'network connection failed' })).toBe('NETWORK_ERROR');
  });

  it('classifies permission denied errors as PERMISSION_DENIED', () => {
    expect(classifyFirebaseError({ code: 'permission-denied' })).toBe('PERMISSION_DENIED');
    expect(classifyFirebaseError({ code: 'firestore/permission-denied' })).toBe('PERMISSION_DENIED');
    expect(classifyFirebaseError({ message: 'Missing or insufficient permissions.' })).toBe('PERMISSION_DENIED');
  });

  it('classifies unauthenticated errors as UNAUTHENTICATED', () => {
    expect(classifyFirebaseError({ code: 'unauthenticated' })).toBe('UNAUTHENTICATED');
    expect(classifyFirebaseError({ code: 'auth/user-not-found' })).toBe('UNAUTHENTICATED');
  });

  it('classifies other unknown errors as OTHER', () => {
    expect(classifyFirebaseError({ code: 'resource-exhausted' })).toBe('OTHER');
    expect(classifyFirebaseError('random string error')).toBe('OTHER');
  });
});
