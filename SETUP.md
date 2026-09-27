# Try it yourself — local setup

Everything (backend, frontend, extension) lives in this one repo. This walks through running all three locally so you can try the actual core loop: capture a reference in one click, then design next to it.

## 1. Prerequisites

- Node.js 22+ (`node --version`)
- PostgreSQL 16 (`psql --version`) — install via [postgresql.org](https://www.postgresql.org/download/) or `brew install postgresql@16`
- Chrome (for the extension)

## 2. Clone the repo

```bash
git clone https://github.com/Stedan1234/moodloom.git
cd moodloom
```

## 3. Create the local database

With Postgres running:

```bash
createdb moodloom
psql moodloom -c "CREATE USER moodloom WITH PASSWORD 'moodloom_dev' CREATEDB;"
psql moodloom -c "GRANT ALL PRIVILEGES ON DATABASE moodloom TO moodloom;"
```

Use whatever password you like — just make sure it matches the `DATABASE_URL` you set in the next step.

## 4. Backend

```bash
cd backend
cp .env.example .env   # edit DATABASE_URL to match your local Postgres user/password
npm install
npm run migrate        # creates the tables
npm run dev
```

You should see `Moodloom backend listening on http://localhost:3001`. Leave this running in its own terminal tab.

## 5. Frontend

In a new terminal tab:

```bash
cd frontend
cp .env.example .env   # defaults to http://localhost:3001, fine as-is
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`) in Chrome — you should see the empty Moodloom project list.

## 6. Load the capture extension

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `moodloom/extension` folder

A plain "Add to Moodloom" icon appears in your toolbar. No branding yet — that's deliberate; visual identity is a later phase, after this loop is validated.

## 7. Try the real test

Go to any page with a reference you'd actually use for a project — a YouTube video, a Dribbble shot, an Instagram post, anything. Click the extension icon, create a new project (or pick one), hit **Add to board**.

Open the frontend, click into that project, and confirm the reference shows up — video should play inline, images should render inline, other links show as a card.

## 8. Try the side-by-side workspace

With the board open, type into the **Workspace** panel on the right — notes, a color direction, anything. It autosaves as you type. Reload the page and confirm both the board items and your notes are still there.

That reload-and-persist check is the whole point: this is the actual core loop the MVP exists to prove — find a reference, one click, it's sitting there structured and ready when you go to design, with no tab-switching in between.

## Known limitations (v1, by design)

- No visual/brand identity yet — this is a functional prototype (see `mvp-scope.md` for what's deliberately deferred to v2)
- Instagram links save fine but don't render an inline embed yet (their oEmbed API needs Meta app review — flagged in `backend/src/services/mediaDetector.js`)
- CORS is wide open on the backend for local dev — needs tightening before this touches the public internet
- Board layout is a fixed grid, not freeform — a deliberate v1 decision (see `mvp-scope.md`)
