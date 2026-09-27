# Moodloom

A structured, capture-at-source moodboard tool for designers — collect video, images, links, and color references natively, and design right next to them without tab-switching.

## Why this exists

Designers constantly bounce between Pinterest, YouTube, and browser tabs to gather references while working — a fragmented workflow that creates real reluctance to even start a design session. Moodloom's core mechanic is **capture-at-source**: a one-click "Add to Moodloom" action from wherever a reference is found, straight into a specific project, so nothing sits in cold storage waiting to be organized later.

Full positioning, competitive landscape, and MVP scope live in the attached Claude Project ("My Career Path" → `moodloom/product-marketing.md` and `moodloom/mvp-scope.md`).

## Structure

- **`backend/`** — Node.js + Express + PostgreSQL API. Projects, board items (references), workspace notes, and anonymous-by-default auth with optional email claim.
- **`extension/`** — Chrome extension (Manifest V3) that captures the active tab into a Moodloom project in one click. This is the v1 capture mechanism (full native OS share-sheet integration is a deferred v2 item — see `mvp-scope.md`).

## Status

MVP build in progress. Backend foundation and capture prototype are built and verified end-to-end. Next: board view (frontend) and minimal workspace area.

## Local setup

**Backend:**
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
npm install
npm run migrate
npm run dev
```

**Extension:**
Load `extension/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked). Points at `http://localhost:3001` by default.
