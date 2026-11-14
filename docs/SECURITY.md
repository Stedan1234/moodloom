# Security

What Moodloom protects, how, and what is knowingly left for later. Written to be checked against the code, not taken on trust; file names are given throughout.

## What matters

1. **A designer's unreleased work and client material** (references, briefs, notes, brand kits, manuscripts).
2. **Accounts** (email, password, sessions).
3. **The server itself**, which fetches URLs users give it and stores files users upload.

## Who might attack, and what stops them

| Threat | Defence | Where |
|---|---|---|
| Reading or changing someone else's project | Every project route loads the project together with the caller's role; no role means 404. Item and category ids are always checked against the project in the URL. | `middleware/project.js`, tested in `test/security.test.js`, `test/sharing.test.js` |
| Stolen or leaked database | Passwords are bcrypt hashes. Reset, share and invite tokens are stored only as SHA-256 hashes. Pairing codes live five minutes and work once. | `routes/auth.js`, `routes/sharing.js` |
| Stolen session token | Tokens expire (90 days by default) and carry a version; changing or resetting the password, or "sign out everywhere", revokes all earlier ones. | `middleware/auth.js`, `routes/account.js` |
| Guessing passwords, codes or links | Rate limits per route group, strictest on login, pairing, reset and public share links. Reset and login answers don't reveal whether an email exists. | `middleware/rateLimit.js`, `test/ratelimit.test.js` |
| Script injection through saved content (XSS) | The web app never inserts server data as HTML. Notes go through the editor's schema. Video players are built from a validated id. Links are rendered only if http(s). A strict Content-Security-Policy (no inline script, no third-party script) backs this up. | `frontend/src`, `app.js` |
| Malicious uploads | Type is decided from the file's bytes. Executables, HTML and scripts are refused. SVG is accepted only when it really is one, is only ever shown through an image tag (where script can't run), and like every upload is served under a sandboxing policy. Stored names are random. Files are served with `nosniff`, a sandboxing CSP, and as downloads unless a known preview type. Size limits per type. | `services/files.js`, `app.js`, `test/items.test.js` |
| Making the server fetch internal addresses (SSRF) | Only http(s). The hostname is resolved by a lookup that refuses private, loopback, link-local and metadata addresses, so DNS tricks don't help. Redirects are followed by hand and re-checked. Responses are capped in size and time. | `lib/safeFetch.js`, `test/security.test.js` |
| Cross-site requests | No cookies are used, so there is nothing for a forged request to ride on. CORS allows only listed origins and browser extensions. | `app.js` |
| Clickjacking, sniffing, downgrade | `frame-ancestors 'none'`, `nosniff`, HSTS in production, referrer policy, via helmet. | `app.js` |
| Oversized or malformed requests | Body size limits; every route validates its input with a schema and rejects unknown shapes. | `lib/validate.js`, routes |
| Private material leaking to an AI provider | Nothing is sent unless the server has a key **and** the project owner has switched it on for that project. Only the selected references, shrunk, plus titles, notes, tags and the brief are sent, and only when a note is requested. | `routes/ai.js`, `services/ai/direction.js`, `test/ai.test.js` |
| Secrets in logs | Request logs record the route pattern, not the URL, because share and invite links carry their secret in the path. | `app.js` |
| Weak configuration | The server refuses to start with a missing or placeholder `JWT_SECRET`, with http URLs in production, or with the mock AI provider in production. | `config.js` |

## Checked, and how

- 58 automated API tests, including cross-account access, role enforcement, upload refusals, SSRF targets and rate limits.
- 44 browser flows run end to end, including under the production Content-Security-Policy with zero violations.
- `npm audit`: 0 known vulnerabilities in backend and frontend at the time of writing; CI fails on high-severity findings.

This is a careful self-review, not an external penetration test.

## Known gaps, in the order worth fixing

1. **Session token in `localStorage`.** Any script running on the page could read it. The CSP and the no-HTML rule make that hard, but an httpOnly cookie with CSRF protection is stronger. Revisit before a public launch.
2. **Uploaded files are readable by anyone who has the URL.** The URLs are long and random and are only shown to people with access, but they are not checked per request. Signed, expiring URLs fix this and come naturally with object storage.
3. **No malware scanning** of held files. Moodloom never executes them and serves them as downloads, but a file could carry something for whoever opens it. Add scanning (e.g. ClamAV) before accepting files from strangers at scale.
4. **No email verification.** An address is taken on trust when an account is saved. Add a confirmation email before invitations are sent by email.
5. **No second factor**, and no lockout beyond rate limiting.
6. **Single server.** Rate limits and the job queue are in memory; they need a shared store (Redis) once there is more than one instance.
7. **No audit log** of who changed what on a shared project.
8. **Privacy policy and terms** exist only as drafts and need a lawyer's review before launch.

## Reporting a problem

Email the maintainer privately rather than opening a public issue. Include what you did and what happened.
