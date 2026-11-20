# Security Specification — Auto Clipper Studio App Updates Firestore Rules

## 1. Data Invariants
1. Firestore is dedicated exclusively to application update releases (`/appReleases/{releaseId}`) and read-only admin role lookups (`/admins/{adminId}`).
2. All writes (`create`, `update`, `delete`) and reads of `developing` (in-development) releases are restricted strictly to the verified developer admin (`request.auth != null && request.auth.token.email_verified == true` AND matching `danendrapradana44@gmail.com` or `/admins/{uid}`).
3. Public/client update checks can ONLY read documents where `resource.data.status == 'published'`; `developing` releases are never exposed to non-admins.
4. No PII (email, phone, address) is stored inside `/appReleases/{releaseId}`.
5. `version` and `baseVersion` MUST match `^[0-9]+\.[0-9]+\.[0-9]+$`, `updateType` is strictly `'minor'` (+0.0.1) or `'major'` (+0.1.0), and `status` is `'developing'` or `'published'`.
6. `createdAt` and `ownerId` are immutable; timestamps MUST equal `request.time`.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated user attempting `get` or `list` on `/appReleases` where `status == 'developing'`.
2. Unauthenticated user attempting `create` on `/appReleases/v1-5-1`.
3. Non-admin authenticated user (`other@gmail.com`, `email_verified: true`) creating/updating/deleting `/appReleases/v1-5-1`.
4. Spoofed admin email (`danendrapradana44@gmail.com`) with `email_verified: false` writing or reading `developing` releases.
5. Admin creating `/appReleases/v1-5-1` with `ownerId: "someoneElse"` (identity spoofing).
6. Admin creating `/appReleases/v1-5-1` with shadow field `isOfficial: true` (rejected by `hasOnly`).
7. Admin creating `/appReleases/v1-5-1` with client-forged `createdAt` != `request.time`.
8. Admin updating `/appReleases/v1-5-1` trying to mutate `createdAt` or `ownerId`.
9. Admin creating `/appReleases/v1-5-1` with invalid version string `"v1.5.1-beta"` (rejected by regex).
10. Admin creating `/appReleases/bad..id!` with illegal document ID characters (rejected by `isValidId`).
11. Admin creating `/appReleases/v1-5-1` with `changes` array containing 50 items or non-string first element (rejected by size & type guard).
12. Any client attempting to write to `/admins/{uid}` or any legacy/catch-all path like `/users/u1/projects/p1`.
