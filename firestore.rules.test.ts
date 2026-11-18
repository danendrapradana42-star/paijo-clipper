/**
 * Adversarial "Dirty Dozen" Security Rules Payload Specification
 * Reference test matrix verifying all 12 invalid operations are denied by firestore.rules.
 */
export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Unauthenticated read/write to preferences',
    path: '/users/userA/preferences/studio',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email write to own path',
    path: '/users/userA/preferences/studio',
    auth: { uid: 'userA', token: { email_verified: false } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-user read or list of projects',
    path: '/users/userA/projects',
    auth: { uid: 'userB', token: { email_verified: true } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity spoofing (ownerId != request.auth.uid)',
    path: '/users/userA/projects/proj1',
    payload: { ownerId: 'userB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow field injection (isAdmin: true)',
    path: '/users/userA/preferences/studio',
    payload: { isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Client-forged createdAt timestamp',
    path: '/users/userA/projects/proj1',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable createdAt/ownerId mutation on update',
    path: '/users/userA/projects/proj1',
    payload: { ownerId: 'userA', createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Ghost field on aiScripts update',
    path: '/users/userA/aiScripts/s1',
    payload: { systemRole: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Invalid document ID characters',
    path: '/users/userA/aiScripts/bad..id!',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unbounded clips array (> 25 items)',
    path: '/users/userA/projects/proj1',
    payload: { clipsCount: 100 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'AI script below minimum 5-minute duration',
    path: '/users/userA/aiScripts/s1',
    payload: { durationMinutes: 2, totalDurationSec: 120 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Access to catch-all denied path',
    path: '/admins/userA',
    expected: 'PERMISSION_DENIED',
  },
] as const;
