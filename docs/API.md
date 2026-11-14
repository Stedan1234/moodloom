# API reference

Base path: `/api`. JSON in, JSON out. Send `Authorization: Bearer <token>` on everything except the routes marked *public*.

Errors are `{ "error": "a sentence a person can read", "code": "OPTIONAL_CODE" }` with a matching HTTP status. `401` means the token is missing, expired or revoked. A project you can't access answers `404`. `402` means a plan limit; `429` a rate limit.

Roles on a project: **owner**, **editor**, **viewer**. "Editor+" below means editor or owner.

## Accounts

| Method and path | Who | What |
|---|---|---|
| `POST /auth/anonymous` | public | New anonymous account. → `{ token }` |
| `POST /auth/claim` | any | `{ email, password }` Attach an email and password (8+ chars) to the current account. |
| `POST /auth/login` | public | `{ email, password }` → `{ token }` |
| `POST /auth/forgot-password` | public | `{ email }` Always the same answer, whether or not the email exists. |
| `POST /auth/reset-password` | public | `{ token, password }` → `{ token }`. Signs out every earlier session. |
| `POST /auth/pairing-code` | any | → `{ code, expiresAt }` One-time, five minutes. |
| `POST /auth/pair` | public | `{ code }` → `{ token }` for the account that made the code. |
| `GET /account` | any | Email, name, plan, limits, usage, which AI features are available. |
| `PATCH /account` | any | `{ displayName }` |
| `POST /account/password` | saved account | `{ currentPassword, newPassword }` → `{ token }` |
| `POST /account/logout-all` | any | Revokes every other session. → `{ token }` |
| `GET /account/export` | any | ZIP of every project you own. |
| `DELETE /account` | any | `{ confirm: "DELETE", password? }` Removes the account, its projects and files. |

## Projects

| Method and path | Who | What |
|---|---|---|
| `GET /projects` | any | Yours and those shared with you, with role, item count and cover images. |
| `POST /projects` | any | `{ name }` Starts with four threads. |
| `GET /projects/:id` | viewer+ | |
| `PATCH /projects/:id` | owner | `{ name?, brief?, stage?, aiEnabled? }` `stage` is `brief`, `research`, `concepts`, `refine` or `deliver`. |
| `DELETE /projects/:id` | owner | |
| `GET /projects/:id/export` | viewer+ | ZIP: files, notes, brief, brand kit, an index. |
| `GET /search?q=` | any | References matching a term across every project you can see. |

## Board (`/projects/:id/items`)

| Method and path | Who | What |
|---|---|---|
| `GET /` | viewer+ | Every reference. |
| `POST /` | editor+ | `{ sourceUrl, title?, note?, tags?, categoryId?, pageUrl? }` Saving the same URL twice returns the first with `alreadyOnBoard: true`. |
| `POST /upload` | editor+ | Multipart `file`, plus optional `title`, `note`, `categoryId`. |
| `POST /quote` | editor+ | `{ text, title?, tags?, categoryId?, fromItemId?, page? }` A passage of text. |
| `POST /reorder` | editor+ | `{ ids: [...] }` in ascending position. |
| `PATCH /:itemId` | editor+ | `{ title?, note?, tags?, categoryId?, position? }` |
| `DELETE /:itemId` | editor+ | Also deletes its file. |
| `GET /:itemId/similar` | viewer+ | → `{ available, items }` nearest references by appearance. |

A reference: `{ id, media_type, title, note, tags, source_url, thumbnail_url, width, height, palette: [{ hex, pct, name }], meta, is_upload, file_name, file_size, mime_type, position, category_id, analyzed, created_at }`. `media_type` is `image`, `video`, `link`, `pdf`, `font`, `file` or `quote`.

Threads: `GET/POST /projects/:id/categories`, `PATCH/DELETE /projects/:id/categories/:categoryId`. `POST` accepts `{ name, itemIds? }` to move references in as it's created.

## Notes, sketch, brand kit

| Path | Methods | Body |
|---|---|---|
| `/projects/:id/workspace` | `GET`, `PUT` | `{ content }` HTML, up to 1 MB |
| `/projects/:id/canvas` | `GET`, `PUT` | `{ scene: { elements, appState, files } }` up to 12 MB |
| `/projects/:id/brand` | `GET`, `PUT` | `{ data }` validated against the brand-kit schema in `routes/brandKit.js` |

## Direction (`/projects/:id/ai`)

| Method and path | Who | What |
|---|---|---|
| `GET /status` | viewer+ | What's available on this server and how much of the board is analysed. |
| `GET /digest?categoryId=` | viewer+ | Shared palette, traits and tags. No model involved. |
| `POST /groupings` | editor+ | Suggested groups among loose references. |
| `GET /suggest-category?itemId=` | editor+ | The thread a loose reference most resembles. |
| `GET /search?q=` | viewer+ | Rank images by a description (CLIP embedder only). |
| `GET /direction` | viewer+ | Saved direction notes. |
| `POST /direction` | editor+ | `{ categoryId?, focus? }` Needs an AI key on the server **and** `aiEnabled` on the project. |
| `DELETE /direction/:noteId` | editor+ | |

## Sharing

| Method and path | Who | What |
|---|---|---|
| `GET/POST /projects/:id/share-links` | owner | `{ includeBoard?, includeBrand?, includeBrief?, includeNotes? }` |
| `PATCH/DELETE /projects/:id/share-links/:linkId` | owner | Change what's included, or turn it off. |
| `GET /projects/:id/members` | viewer+ | People and unused invitations. |
| `POST /projects/:id/invites` | owner | `{ role }` → `{ url }` shown once; single use, seven days. |
| `DELETE /projects/:id/invites/:inviteId` | owner | |
| `PATCH/DELETE /projects/:id/members/:userId` | owner | Change role or remove. A member may remove themselves. |
| `GET /share/:token` | public | The read-only view a link allows. |
| `GET /invites/:token` | public | Project name and role, before accepting. |
| `POST /invites/:token/accept` | saved account | Join the project. |

## Other

`GET /api/health` → `{ ok: true }` when the database answers. Uploaded files are served from `/uploads/<key>`; keys are random and unguessable, and files are sent with a sandboxing policy.
