# Architecture

## One picture

```
 Browser extension ─┐
 Web app (React)  ──┼──  /api  ──  Express API  ──  PostgreSQL
 Installed PWA    ──┘               │   │
                                    │   └── background jobs: analyse image → palette, thumbnail, feature vector
                     /uploads  ─────┘        (in-process queue, resumable from the database)
                                    │
                                    └── optional, opt-in per project: Anthropic API for direction notes
```

One Node process serves the API, the uploaded files and (in production) the built web app, all from a single origin. That choice removes CORS from the normal path, lets one Content-Security-Policy cover the app, and makes deployment one service plus one database.

## Backend (`backend/src`)

| Folder | What lives there |
|---|---|
| `app.js`, `server.js` | Assembles middleware and routes; `server.js` only listens. Tests import `app.js` directly. |
| `config.js` | The only place environment variables are read. Validates them and fails fast at start-up. |
| `db/` | `schema.sql` (idempotent), `migrate.js` (repairs old data, applies schema, backfills), `pool.js`. |
| `middleware/` | `auth.js` (JWT with a per-user token version), `project.js` (loads the project and the caller's role), `rateLimit.js`. |
| `routes/` | One file per resource: auth, account, projects, boardItems, categories, workspace, canvas, brandKit, ai, sharing. |
| `services/` | Work that isn't HTTP: `files.js` (what is this upload?), `analysis.js` (palette), `items.js` (the analysis job), `mediaDetector.js`, `exporter.js` (ZIP), `plans.js`, `serialize.js` (the one place rows become API objects), `ai/`. |
| `lib/` | Small dependencies-free helpers: colour maths, k-means, guarded fetch, validation, storage keys, the job queue. |

### Data model

`users` → `projects` → `board_items`, `categories`, `workspace_notes`, `canvases`, `brand_kits`, `direction_notes`, `share_links`, `project_members`, `project_invites`. Everything cascades from the project, and the project from its owner, so deleting either leaves nothing behind (files on disk are removed explicitly first).

A board item stores where its file is (`file_key`, `thumb_key`), never a URL; URLs are built on the way out so the public address can change without a data migration.

### Identity

Accounts start anonymous: a row and a signed token, no email. Adding an email and password later ("saving" the account) is what makes it recoverable and able to join shared projects. The extension never creates an account; it is paired to the web app's account with a one-time code.

Tokens carry a version number. Changing or resetting the password, or "sign out everywhere", bumps it, which invalidates every token issued before.

### Access

Every project route passes through `loadProject(minRole)`: owner, editor or viewer. A project you can't see returns 404, not 403, so its existence isn't revealed. Share links are a separate, unauthenticated, read-only route that returns only the sections switched on for that link.

### Background analysis

Saving a reference returns at once. An in-process queue then decodes the image, builds a thumbnail, extracts the palette and computes the feature vector. Unfinished work is picked up again at start-up from the database, so a restart loses nothing. At larger scale this becomes a separate worker; the queue interface is the seam for that.

## AI layer (`backend/src/services/ai`)

Three tiers, cheapest first; full detail and measurements in [ai/REPORT.md](ai/REPORT.md).

1. **Algorithms, no model.** Palette by k-means in CIELAB; a 230-number hand-built image descriptor for "more like this", grouping and thread suggestions.
2. **Open pretrained model, optional.** CLIP via ONNX for search by description. Off by default.
3. **Hosted language model, opt-in per project.** Direction notes. The server picks a diverse subset of references, sends them with the brief, validates the reply against a schema, and checks every cited reference id really was sent.

## Web app (`frontend/src`)

React 19, Vite, Tailwind 4. No routing or state library: a 50-line History-API router and component state are enough for a dozen screens. Heavy pieces (the PDF reader, the rich-text editor, each project tab) load on demand.

| | |
|---|---|
| `api.js` | The only place that talks to the server. Creates the anonymous session on first use. |
| `pages/` | Welcome, Home, Project (shell), Account, Shared (public), Invite, Reset, ShareTarget. |
| `project/` | Board, ItemCard, ItemViewer, PdfReader, Notes, Brief, Direction, Sketch, BrandKit(+View), ShareDialog. |
| `ui.jsx`, `index.css` | Shared components and the design tokens. |

Nothing received from the server is ever inserted as HTML. Notes are loaded through the editor's schema; video players are built from a validated id.

## Extension (`extension/`)

Manifest V3. A popup (pair, choose project and thread, save) and a service worker for the right-click menu. It asks for `activeTab`, `storage` and `contextMenus` only, and reads nothing from pages beyond the address and title of the tab you save.

## Decisions worth knowing

- **Cloud-based, not local-first; not open source.** Cross-device use and the paid tier depend on it. Data ownership is handled by ZIP export.
- **Vectors in a Postgres array, compared in Node.** No pgvector dependency, which is painful to install on Windows. Fine up to a few thousand references per project; pgvector is the documented next step.
- **Own sketch pad, not Excalidraw.** The library pulled in vulnerable transitive dependencies and 14 MB of fonts for a feature that needs a pen, a marker and text.
- **Files on local disk.** Simple and correct for one server. Object storage is the next step for scale; `lib/storage.js` is the seam.
