# Changelog

## 3.0 — November 2026

The full product: identity, the AI layer, sharing, and everything around the board.

**New**
- Moodloom's own visual identity across the web app, extension and installable app (see docs/BRAND.md).
- Welcome screen; projects with cover collages; search across every project (Ctrl/Cmd K).
- Board: any file type (images incl. AVIF, video, PDF, fonts, design source files held for download), passages of text, drag and drop, drag to reorder, per-reference notes and tags, filter, threads (categories) with dye colours.
- Reference viewer: colours with names and proportions, "more like this", suggested thread, PDF reader with "pin this passage", live font specimens.
- Brief with project stages; Direction (shared palette, suggested groupings, optional AI direction notes with cited references); Sketch pad that pins to the board; Brand kit builder with print/PDF.
- Sharing: revocable view links with per-section switches, invitation links, viewer and editor roles.
- Account: profile, password change, sign out everywhere, ZIP export of everything, account deletion, plan and usage.
- Phone: installable (PWA), Android share target.
- Extension 0.3: configurable server address, right-click "Save to Moodloom", notes on capture.
- Demo seed (`npm run demo:seed`), CI workflow, Dockerfile, Render blueprint.

**Changed**
- All API routes now live under `/api`. The web app and API are served from one origin in production.
- Sessions can be revoked: changing or resetting a password, or "sign out everywhere", invalidates every earlier token.
- Uploads are identified by their bytes, not their name; executables and HTML are refused; every upload is served under a sandboxing policy.
- Embed HTML is no longer stored or sent; the web app builds players from a validated video id.

**Security**
- Strict Content-Security-Policy for the app, a locked-down one for the API and a sandboxing one for uploaded files; security headers via helmet.
- SSRF-guarded remote fetching (DNS-level private-address refusal, manual redirects, size and time caps).
- Request validation on every route; rate limits per route group; share and invite tokens stored only as hashes.
- 58 automated API tests, including authorisation, upload and rate-limit cases.

## 1.x — September to October 2026

MVP: projects, fixed-grid then masonry board, browser extension with pairing codes, notes, categories, uploads and paste, account saving, password reset, lightbox navigation, collapsible board, rich-text notes.

## 3.0.1 — 14 November 2026

- Sketch: fixed the text tool (the box closed before you could type). Added select and move, rectangle, ellipse, arrow and frames (Phone, Desktop, Square post, Story, A4). Undo now restores deletions and moves.
- Warmer interface: rounder cards and pill buttons, cards land with a bounce and lean on hover, tags and the active thread take dye colours, a greeting on the projects page, friendlier empty board.
