# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Book Metadata Update Detection in pushBooks

When pushBooks() processes a book whose hash already exists in the remote manifest, the system MUST compare `updatedAt` timestamps. If local `book.updatedAt > remoteBook.updatedAt`, the system MUST push the library entry metadata via `transport.pushBookLibrary([book])`. The system MUST track these pushes in the `updated` counter separate from `sent`.

#### Scenario: Title edit pushes metadata to Android

- GIVEN desktop has a book synced to Android with `remoteBook.updatedAt = 100` and the user edits the book title, bumping `book.updatedAt` to `101`
- WHEN pushBooks() runs against the remote manifest
- THEN the book's library entry is pushed to Android via `/books/index`
- AND the return value increments the `updated` counter

#### Scenario: Author edit also triggers update

- GIVEN a synced book where local `updatedAt > remote.updatedAt` due to an author field change
- WHEN pushBooks() runs
- THEN the book library entry is pushed with the updated author metadata

#### Scenario: No-op sync skips unchanged books

- GIVEN local and remote `updatedAt` are equal and the book hash exists on remote
- WHEN pushBooks() runs
- THEN the book is skipped (neither `sent` nor `updated`)
- AND existing hash-based skip behavior for truly identical books is preserved

### Requirement: Android Clean with pm clear

The Android clean mechanism MUST use `adb shell pm clear <package>` as its primary clean operation. This MUST purge `shared_prefs/`, `app_webview/`, `cache/`, and any other app-private directories. After `pm clear`, the cycle MUST re-inject `settings.json` to restore the minimal config required for harness operation.

#### Scenario: Clean leaves Android in known-empty state

- GIVEN a connected Android device with the app package installed and residual sync data present
- WHEN the clean mechanism runs via `dev:sync:clean` or equivalent
- THEN `adb shell pm clear <package>` executes and returns success
- AND subsequent state capture confirms `shared_prefs/`, `app_webview/`, and `cache/` are empty
- AND `settings.json` is present with correct harness config after re-injection
