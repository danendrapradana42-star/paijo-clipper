# Security Specification — Auto Clipper Studio Firestore Rules

## 1. Data Invariants
1. Every document under `/users/{userId}/preferences/{prefId}`, `/users/{userId}/projects/{projectId}`, and `/users/{userId}/aiScripts/{scriptId}` belongs exclusively to `userId` (`ownerId == request.auth.uid == userId`).
2. Writes and reads require `request.auth != null && request.auth.token.email_verified == true`.
3. All document IDs (`userId`, `prefId`, `projectId`, `scriptId`) match `^[a-zA-Z0-9_-]+$` and `size() <= 128`.
4. All timestamps (`createdAt`, `updatedAt`) MUST equal `request.time` on create; `createdAt` and `ownerId` are immutable on update, and `updatedAt` MUST equal `request.time` on update.
5. No unbounded arrays or strings: `clips` array capped at `<= 25` items, `scenes` array capped at `<= 30` items, every string field explicitly bounded.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/userA/preferences/studio`.
2. Authenticated userB with `email_verified: false` writing to own path.
3. UserB reading or listing `/users/userA/projects`.
4. UserA creating `/users/userA/projects/proj1` with `ownerId: "userB"` (identity spoofing).
5. UserA creating `/users/userA/preferences/studio` with shadow field `isAdmin: true` (rejected by `hasOnly`).
6. UserA creating `/users/userA/projects/proj1` with client-forged `createdAt` timestamp != `request.time`.
7. UserA updating `/users/userA/projects/proj1` trying to mutate `createdAt` or `ownerId`.
8. UserA updating `/users/userA/aiScripts/s1` with ghost field `systemRole: "admin"` (rejected by `affectedKeys().hasOnly(...)`).
9. UserA creating `/users/userA/aiScripts/bad..id!` with illegal characters in document ID (rejected by `isValidId`).
10. UserA creating `/users/userA/projects/proj1` with `clips` array containing 100 items or non-map element (rejected by size & first-item guard).
11. UserA creating `/users/userA/aiScripts/s1` with `durationMinutes: 2` (< 5 min minimum) or 50 scenes.
12. Any read or write to unprotected paths like `/test/connection` or `/admins/userA`.
