# Project Requirement — Bright Cloud Web Viewer

## 1. Product

Product name: Bright Cloud

Bright Cloud is a private/shared cloud backup system where Android devices automatically back up files from physical USB storage to Backblaze B2. Humans access and manage those backed-up files through this web application.

The Android application is a headless upload daemon.
The web application is the human-facing viewer and management interface.

The website must behave like a real file-management product rather than a marketing website.

---

## 2. Core User Types

### Admin

The Admin is the primary owner of a vault.

Admin capabilities include:
- sign in using Google
- view the vault
- browse all authorized sources and files
- view file metadata
- download authorized files
- manage friends/viewers
- manage file permissions
- manage folder permissions
- manage vault-related settings
- view backup activity

### Friend / Viewer

A Friend/Viewer is a human Google-authenticated user.

Friend capabilities depend on permissions:
- view authorized files/folders
- browse permitted locations
- view permitted file metadata
- download permitted files

Friends must not automatically receive access to everything.

---

## 3. Authentication

Human users authenticate with Google Sign-In through Firebase Authentication.

The primary login experience is:

Google Sign-In
→ authenticated session
→ application

Do not create:
- email/password authentication
- custom password forms
- anonymous human login

Anonymous Firebase authentication belongs to the Android ingestion daemon and must not be presented as a human login option.

---

## 4. Vault Model

The application is organized around a shared logical vault.

Primary conceptual structure:

Vault
→ Sources
→ Files
→ Folders
→ Permissions
→ Activity

The web UI should make the vault feel like the primary storage container.

A user should always understand:
- which vault they are viewing
- which source a file belongs to
- which folder the file belongs to
- whether they have access

---

## 5. Physical Backup Sources

A source represents a physical USB storage device.

Sources have stable identity independent of the phone used for backup.

The UI should represent a source with user-friendly information such as:
- source name
- source identifier
- last seen
- last backup
- file count
- current/recent backup status

Do not expose raw internal implementation details unless explicitly appropriate for an admin diagnostic view.

Do not display internal Firebase Anonymous UIDs as normal source identifiers.

---

## 6. File Organization

Files retain their relative folder paths from the physical USB storage.

Examples:

Documents/
Documents/Projects/
Photos/
Photos/2026/
Videos/
etc.

The interface must preserve this hierarchy.

Users should be able to:
- open folders
- navigate into nested folders
- navigate back using breadcrumbs
- understand the current location
- search for files
- sort file listings
- switch between list/grid presentation where appropriate

---

## 7. File Identity

A file is identified by its metadata and cloud record, not merely by filename.

The system supports:
- different files with the same filename in different folders
- content SHA-256
- file versions
- uploaded timestamp
- source
- relative path

Do not design the UI as though filenames are globally unique.

Example:

Documents/report.pdf
Projects/report.pdf

These are separate files.

---

## 8. Versioning

If the same relative path and filename changes content, the backup system can create a new version.

The UI should make version information understandable.

A file details view should be capable of showing:
- current version
- previous versions when available
- version number
- upload time
- file size
- SHA-256

Do not invent unsupported version-management actions.

The viewer should primarily allow users to inspect and download the versions they are authorized to access.

---

## 9. Deduplication

The backend performs SHA-256 based deduplication.

The UI may show a status such as:
- Uploaded
- Duplicate skipped

but should not expose complicated internal deduplication mechanics to ordinary users.

Do not make deduplication a major dashboard feature.

---

## 10. File Metadata

A file details interface should support displaying:

- filename
- file type
- size
- relative path
- source
- version
- upload timestamp
- SHA-256
- access/share status

The layout must make important information easy to scan.

SHA-256 should be treated as technical metadata, not the primary visual focus.

---

## 11. Download

Human users download files through an authorized backend flow.

The conceptual flow is:

Google-authenticated user
→ request download authorization for a specific file
→ authorization verifies access
→ backend derives the authorized B2 object
→ temporary download authorization
→ browser downloads the file directly

The UI should expose only the user-facing action:

Download

Do not expose:
- raw B2 URLs
- presigned URLs
- B2 object keys
- Firebase UIDs
- access tokens
- backend secrets
- internal authorization logic

The website must never ask the user to paste or enter a B2 URL.

---

## 12. Permission Model

Permissions are important and must be understandable.

The system supports:
- Admin access
- Friend/Viewer access
- file-level access
- folder-level access
- friend-specific access
- public-to-friends style access where supported by the existing product model

The interface should clearly distinguish:
- who has access
- what they have access to
- whether access applies to a file or folder

Permission editing should be deliberate and understandable.

Do not expose internal Firestore rule implementation.

---

## 13. Friend Management

Admin users need a practical way to manage human collaborators.

The interface should support concepts such as:
- authorized friends
- friend identity/email
- access state
- files/folders shared
- add friend
- remove/revoke access

Do not create a fake social network interface.

This is access management for private storage.

---

## 14. Shared Files

The Shared section should show content explicitly shared with the current user.

Depending on the user's role, it can show:
- shared files
- shared folders
- who shared them
- access type
- last modified/uploaded information

The UI should make shared access distinct from private content.

---

## 15. Activity

Activity represents backup and cloud events.

Relevant concepts include:
- backup started
- files discovered
- upload completed
- duplicate skipped
- backup completed
- backup interrupted
- backup recovered

The activity UI should be chronological and practical.

Do not create fake analytics, productivity metrics, AI summaries, or invented health scores.

---

## 16. Dashboard

The dashboard is a practical entry point.

It should help users quickly reach:
- recent files
- sources
- recent backup activity
- storage overview
- commonly used areas

Do not turn it into an analytics-heavy dashboard.

Do not invent numbers that the backend does not provide.

Do not create unsupported "AI insights", recommendations, or predictions.

---

## 17. Search

Users should be able to search their accessible files.

Search should be designed around practical file management.

Useful searchable concepts may include:
- filename
- file type
- path/folder
- source

Do not expose backend database queries or internal IDs.

---

## 18. Sorting and Filtering

File browsing should support practical controls such as:
- name
- size
- upload time
- type
- version where appropriate

Filters should remain understandable and not become a complicated analytics interface.

---

## 19. File Types

The backup system intentionally supports arbitrary readable regular user files rather than relying on a small extension whitelist.

The viewer therefore must be designed generically.

Examples may include:
- PDF
- image
- video
- archive
- document
- unknown extension
- extensionless file

Do not assume every uploaded file can be previewed in the browser.

When preview is unsupported, provide metadata and a Download action.

---

## 20. File Preview

Preview behavior should be treated as optional and capability-dependent.

Examples:
- image preview where supported
- PDF preview where supported
- metadata-first presentation for unsupported types

Do not fabricate previews for unsupported file formats.

Do not make preview the only way to access a file.

Download remains a primary action.

---

## 21. Storage Overview

The dashboard may display useful storage information if that data is available.

Do not invent:
- fake storage limits
- fake usage percentages
- fake file counts
- fake backup health scores

UI placeholders may be used during design but must clearly represent sample data rather than implying unsupported backend guarantees.

---

## 22. Error and Failure Handling

Design proper product states for:

- failed authentication
- permission denied
- missing file
- unavailable file
- download failure
- network error
- empty folder
- empty vault
- source unavailable
- loading
- backup activity loading

Error messages should be clear and human-readable.

Do not expose stack traces, backend exceptions, API secrets, raw Firestore paths, or B2 implementation details.

---

## 23. Security Expectations

Security is a major product requirement.

The UI must never expose:
- B2 application credentials
- Firebase service-account credentials
- access tokens
- refresh tokens
- presigned download URLs as visible technical data
- raw B2 object keys
- internal backend secrets
- internal Firebase anonymous device IDs as human-facing identifiers unless explicitly needed for an admin diagnostic feature

The web application is for authenticated humans.

The Android anonymous upload identity is a separate security boundary and should not be presented as a human account.

---

## 24. Responsive Requirements

The same product must work on:
- desktop
- laptop
- tablet
- mobile

The mobile experience must preserve:
- file browsing
- breadcrumbs/navigation
- file details
- download actions
- source browsing
- access/permission understanding

Do not simply shrink the desktop interface.

---

## 25. Core Navigation

Primary navigation should support:

Dashboard
Files
Sources
Shared
Activity
Settings

Admin-only management controls may appear where appropriate without creating unnecessary navigation complexity.

---

## 26. Application States

Design all important reusable states:

### Authentication
- signed out
- signing in
- signed in
- authentication failed

### Data
- loading
- populated
- empty
- error

### Permissions
- allowed
- restricted
- permission denied

### File
- available
- unavailable
- downloading
- download success
- download failure

### Backup activity
- running
- completed
- interrupted
- recovered

---

## 27. What the Website Must NOT Become

Do not turn Bright Cloud into:

- an AI application
- a chatbot
- a social network
- a generic SaaS dashboard
- a marketing landing page
- a developer console
- a crypto dashboard
- a futuristic cyber-security interface
- a fake analytics platform

It is a **professional private cloud file viewer and access-management application**.

---

## 28. Implementation-Oriented Design

The design must be realistic to implement in a modern web stack such as React/Next.js.

Create reusable patterns that can map naturally to components such as:

- AppShell
- Sidebar
- Header
- Breadcrumbs
- FileTable
- FileRow
- FolderRow
- FileDetails
- SourceCard
- ActivityTimeline
- PermissionPanel
- UserAccessList
- SearchBar
- SortMenu
- FilterMenu
- DownloadButton
- StatusBadge
- EmptyState
- ErrorState
- LoadingState
- Dialog
- Toast

Do not generate impossible interactions that depend on imaginary backend features.

---

## 29. Design System Requirement

Create a complete reusable design system for Bright Cloud based on Design.md and these product requirements.

The design system should define reusable patterns for:
- navigation
- buttons
- inputs
- tables
- file rows
- folders
- metadata
- badges
- dialogs
- permissions
- activity items
- states
- responsive behavior

Keep the system visually consistent across all screens.

---

## 30. Final Screens Required

Create a cohesive high-fidelity product including:

1. Google Sign-In
2. Dashboard
3. Files
4. Folder navigation
5. File details
6. File version/history view
7. Sources
8. Shared
9. Admin permissions
10. Friend management
11. Activity
12. Settings
13. Download states
14. Loading states
15. Empty states
16. Error states
17. Permission denied state
18. Mobile versions of the main experiences

Use realistic fictional sample data only where needed for visual design.

Do not invent product capabilities outside these requirements.

---

## Final Design Instruction

Treat:

[Design.md]
= authoritative visual/design/UX direction

[Project_requirement.md]
= authoritative product/functionality requirements

Build one unified Bright Cloud product from both sources.

Do not repeat the design brief unnecessarily.
Do not invent new product features.
Do not add AI features.
Do not expose technical backend implementation details.
Do not turn the application into a marketing page.

The final result should be detailed enough that the next stage can implement the interface directly in React/Next.js while preserving the Bright Cloud product requirements.