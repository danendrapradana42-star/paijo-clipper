/**
 * Adversarial "Dirty Dozen" Security Rules Payload Specification
 * Reference test matrix verifying all 12 invalid operations on /appReleases and /admins return PERMISSION_DENIED.
 */
export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Unauthenticated read of developing release',
    path: '/appReleases/v1-5-1',
    existingData: { status: 'developing' },
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unauthenticated write to appReleases',
    path: '/appReleases/v1-5-1',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Non-admin verified user creating a release',
    path: '/appReleases/v1-5-1',
    auth: { uid: 'userB', token: { email: 'other@gmail.com', email_verified: true } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Spoofed admin email with email_verified: false',
    path: '/appReleases/v1-5-1',
    auth: { uid: 'spoof', token: { email: 'danendrapradana44@gmail.com', email_verified: false } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity spoofing (ownerId != request.auth.uid)',
    path: '/appReleases/v1-5-1',
    payload: { ownerId: 'otherUid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow field injection (isOfficial: true)',
    path: '/appReleases/v1-5-1',
    payload: { isOfficial: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client-forged createdAt timestamp',
    path: '/appReleases/v1-5-1',
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable createdAt/ownerId mutation on update',
    path: '/appReleases/v1-5-1',
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Invalid version format ("v1.5.1-beta")',
    path: '/appReleases/v1-5-1',
    payload: { version: 'v1.5.1-beta' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Invalid document ID characters',
    path: '/appReleases/bad..id!',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded changes array (> 20 items) or invalid item type',
    path: '/appReleases/v1-5-1',
    payload: { changes: [12345] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Client write to /admins or catch-all legacy path',
    path: '/users/userA/projects/proj1',
    expected: 'PERMISSION_DENIED',
  },
] as const;
