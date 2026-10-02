# Bright Cloud Web Viewer — Design Direction

## Product Identity

**Product:** Bright Cloud  
**Type:** Private cloud backup and file viewer  
**Goal:** A polished, credible, professional storage product that feels intentionally designed by a real product team.

Bright Cloud should feel like a mature file-management utility, not an AI application, startup landing page, developer dashboard, gamer UI, or design experiment.

The interface should communicate reliability, privacy, order, simplicity, technical competence, trust, and calmness.

## Absolute Requirement: No AI Feel

**The website must not look AI-generated.**

Do not use:
- AI assistant or chatbot
- “Ask AI” or prompt fields
- sparkle/magic icons
- generative AI feature cards
- futuristic/glowing UI
- excessive gradients
- heavy glassmorphism
- huge marketing slogans
- fake analytics
- fake “smart” features
- unnecessary charts
- excessive floating cards
- decorative 3D illustrations

This is a **file-management application**, not an AI product.

## Desired Personality

Think:
- premium file utility
- quiet confidence
- modern desktop software
- professional cloud storage
- carefully designed internal product
- practical, not decorative

Avoid:
- flashy SaaS template
- cyberpunk/futuristic styling
- gamer styling
- generic AI dashboard
- social-media style cards
- overly playful startup branding

The product should feel comfortable to use for years.

---

# Brand

## Logo

Use the existing Bright Cloud logo artwork.

Rules:
- Preserve the original artwork, proportions, colors, and scaling.
- Do not redesign it.
- Do not add glow, 3D effects, outlines, or decorative elements.
- Do not recolor it unless required for contrast.

## Brand Accent

Bright Cloud uses **orange** as the main brand accent.

Use orange selectively for:
- primary actions
- active navigation
- links
- selected states
- focus states
- important controls

Do not make the whole application orange.

The interface should remain primarily white and neutral.

---

# Color Direction

Primary surfaces:
- white
- near-white/light neutral backgrounds
- very light neutral sidebar/panels

Borders:
- subtle neutral borders
- enough separation to clarify structure without visual heaviness

Text:
- dark neutral for primary text
- medium neutral for secondary text
- muted neutral for metadata
- orange for interaction/active emphasis

Semantic status colors:
- restrained green for success
- restrained amber for warning
- restrained red for errors
- restrained blue for information

Do not rely on color alone to communicate state.

---

# Typography

Use one clean, neutral sans-serif family throughout.

Characteristics:
- highly readable
- professional
- strong hierarchy
- excellent at small sizes

Approximate hierarchy:
- page title: 24–30px
- section title: 17–20px
- body: 14–16px
- table text: 13–14px
- metadata: 12–13px
- buttons: 13–14px

Avoid decorative fonts and oversized display typography inside the application.

---

# Layout

Use a stable application shell.

Desktop:

    ┌───────────────────────────────────────────────────────┐
    │ Header / contextual top bar                           │
    ├──────────────┬────────────────────────────────────────┤
    │              │                                        │
    │ Sidebar      │ Main content                           │
    │              │                                        │
    │ Navigation   │ Page title / actions                   │
    │              │ Breadcrumbs                            │
    │              │                                        │
    │              │ Files / folders / details              │
    │              │                                        │
    └──────────────┴────────────────────────────────────────┘

Keep the sidebar compact.

Use disciplined alignment and comfortable content padding.

Avoid giant empty spaces.

---

# Spacing

Use a consistent scale:

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 px

Avoid random spacing.

---

# Corner Radius

Use restrained radii:
- 6px
- 8px
- 10px
- 12px where appropriate

Do not turn every element into a pill.

Pills should mainly be used for compact status badges/tags.

---

# Shadows

Use shadows sparingly.

Prefer:
- borders
- whitespace
- hierarchy
- subtle elevation

Avoid large blurry shadows.

---

# Navigation

Primary sidebar:
- Dashboard
- Files
- Sources
- Shared
- Activity
- Settings

The current section should have a clear but understated active state, using the orange accent.

---

# File Browser

The file browser is the core experience.

It should feel familiar and predictable, like a professional desktop file manager.

Required:
- breadcrumbs
- folders/files
- search
- sorting
- list/grid toggle
- selection states
- readable metadata
- predictable actions

Example:

    Vault / USB Source / Documents / Projects

Always make the current location obvious.

---

# File Table

Desktop browsing should primarily use a clean list/table.

Columns:

    Name | Type | Size | Version | Uploaded | Access

Rows should be compact, readable, aligned, and easy to scan.

Do not turn every row into a large card.

---

# File Details

Show:
- filename
- file type
- size
- relative folder path
- source
- version
- upload timestamp
- SHA-256 metadata
- access information

Primary action:

**Download**

Never expose internal B2 object keys or authorization internals.

---

# Dashboard

The dashboard is a useful starting point, not an analytics dashboard.

Prioritize:
- recently backed-up files
- connected sources
- recent activity
- useful storage overview
- navigation shortcuts

Do not invent arbitrary metrics, fake insights, or unnecessary charts.

Every dashboard element should answer a practical question.

---

# Sources / USB

Represent physical backup sources clearly.

Each source can show:
- source name
- source identifier
- last backup activity
- file count
- backup status
- last seen
- open source

Use simple drive/USB icons.

Do not use futuristic USB graphics.

---

# Shared / Permissions

Permissions must be understandable to normal users.

Use plain labels:
- Admin
- Viewer
- Shared with
- Folder access
- File access
- Public to friends

Make permission changes deliberate and easy to understand.

---

# Activity

Show a normal software history/timeline.

Examples:
- Backup started
- Files discovered
- Upload completed
- Duplicate skipped
- Backup completed
- Backup interrupted
- Backup recovered

Use small status icons and timestamps.

---

# Settings

Keep settings practical:
- Account
- Vault
- Permissions
- Appearance
- Security

Avoid an unnecessarily complex admin console.

---

# Responsive Design

Support:
- desktop
- laptop
- tablet
- mobile

Mobile should be intentionally designed, not simply shrunk.

Use:
- compact header
- collapsible navigation
- bottom navigation when useful
- touch-friendly file rows
- stacked metadata
- full-page or bottom-sheet file details

On smaller screens, tables may become compact list rows.

---

# Icons

Use one consistent professional icon family.

Characteristics:
- simple
- familiar
- consistent stroke/weight
- restrained

Common icons:
- folder
- file
- download
- search
- settings
- users
- storage
- USB/source
- activity
- chevron
- more
- lock/access

No sparkle or AI icons.

---

# Motion

Motion should be subtle and functional.

Use it only for:
- navigation
- loading
- expansion/collapse
- selection
- download progress
- state changes

Avoid bouncing, parallax, animated gradients, floating cards, or constant motion.

---

# States

Create reusable:
- loading
- empty
- error
- permission denied
- file unavailable
- download in progress
- download success
- download failure

Use clear practical wording and avoid exposing backend details.

---

# Download Experience

Download is a core action.

Show:
- download action
- progress where applicable
- success
- failure/retry

Never show:
- presigned URLs
- B2 object keys
- Firebase UIDs
- tokens
- backend secrets

---

# Security-Aware UX

Security should be represented through clear UX, not fear or technical jargon.

Show:
- signed-in identity
- sharing status
- permissions
- access boundaries

Do not expose cryptographic or backend implementation details.

---

# Realistic Example Data

Use believable fictional data such as:

    Agriculture.pdf
    Respiration.pdf
    Documents/
    Photos/
    Projects/
    Videos/

Avoid silly or obviously AI-generated placeholder names.

---

# No Marketing-Landing-Page Feel

This is an authenticated application.

Do not make main product screens look like:
- startup landing pages
- pricing pages
- product launch pages
- portfolio case studies

The login page can be branded, but after login the product should immediately feel like a real file application.

---

# Reusable Components

Design reusable patterns for:
- buttons
- icon buttons
- sidebar
- breadcrumbs
- file rows
- folder rows
- status badges
- dialogs
- dropdowns
- search
- tables
- cards
- tabs
- permission controls
- toasts
- empty states
- loading states

Consistency matters more than novelty.

---

# Required Screens

Design a cohesive system containing:

1. Google Sign-In
2. Dashboard
3. Files / file explorer
4. Folder view
5. File details
6. Sources
7. Shared
8. Admin permissions
9. Activity
10. Settings
11. Mobile dashboard
12. Mobile files
13. Mobile file details
14. Loading states
15. Empty states
16. Error states
17. Permission-denied state
18. Download progress/success/failure

---

# Quality Bar

The final result should look like a commercial private-cloud file product.

It should have:
- consistent spacing
- restrained color
- excellent hierarchy
- practical navigation
- realistic content
- professional typography
- coherent iconography
- clear file browsing
- strong mobile adaptation
- no visual gimmicks

Core principle:

> Make the product feel intentionally designed, not generated.

---

# Stitch Prompt

Paste the following prompt into Stitch and use this design brief as the reference/authority:

Create a complete high-fidelity web application design for "Bright Cloud", a private cloud backup and file viewer.

Use the attached/reference design brief "Bright Cloud Web Viewer — Design Direction" as the primary design authority. Follow its visual language, product personality, typography, spacing, color direction, layout rules, component behavior, responsive strategy, and anti-patterns.

This must look like a polished real-world file-management application designed by an experienced product/UI team.

CRITICAL REQUIREMENT:
The product must NOT look AI-generated.

There must be absolutely no AI features or AI-related interface elements:
- no chatbot
- no AI assistant
- no "Ask AI"
- no prompt box
- no sparkle/magic icons
- no AI analytics
- no generative feature cards
- no futuristic AI visual language

This is a professional cloud storage/file viewer, not an AI product.

Use the existing Bright Cloud logo artwork without redesigning it.

Use a white-first neutral interface with restrained Bright Cloud orange accents.

The final UI should feel comparable in usability and maturity to established file-storage products while remaining visually distinct as Bright Cloud.

Prioritize:
- professional hierarchy
- realistic spacing
- restrained borders and shadows
- compact navigation
- excellent file browsing
- clean table/list patterns
- clear breadcrumbs
- intuitive download actions
- understandable permissions
- realistic metadata
- responsive mobile layouts
- accessible interactions

Do not add fake features, invented metrics, unnecessary charts, or decorative dashboard widgets.

Design these screens as one cohesive product:
1. Google Sign-In
2. Dashboard
3. Files
4. Folder view
5. File details
6. Sources
7. Shared
8. Admin permissions
9. Activity
10. Settings
11. Mobile dashboard
12. Mobile files
13. Mobile file details
14. Loading states
15. Empty states
16. Error states
17. Permission denied
18. Download progress/success/failure

Use believable fictional file data such as Agriculture.pdf, Respiration.pdf, Documents/, Photos/, Projects/, and Videos/.

Do not expose:
- B2 object keys
- Firebase UIDs
- presigned URLs
- tokens
- backend secrets
- internal authorization implementation

Create a reusable visual design system and reusable component patterns.

The finished result should feel calm, precise, trustworthy, premium, and production-ready.

Above all:
Make it look intentionally designed by a professional human product team, not like an AI-generated concept.

Do not solve backend architecture during the design phase. The deliverable is the high-fidelity Bright Cloud web UI/UX that can later be implemented and connected to the existing Firebase, Firestore, B2-authorizer, and storage architecture.
