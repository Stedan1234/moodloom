# Moodloom

A project's references, notes and direction in one place, so starting to design doesn't begin with a hunt across four apps.

Moodloom is a web app, a browser extension and an installable phone app that share one account:

- **Collect.** Save a page, image or link in one click from the browser; paste a screenshot; drop in files (images, video, PDF, fonts, design source files); share from another app on Android. Everything lands on the board of the project it's for.
- **Read the wall.** Every image is analysed for its colours. The board shows the palette its references share, finds "more like this", and suggests how loose references group together. This runs on Moodloom's own server; nothing is sent anywhere.
- **Decide.** A written brief, rich-text notes beside the board, a sketch pad, and a brand kit assembled from what's on the board. Optionally, a language model drafts a direction note that has to cite the references it's drawn from. That is off until the project's owner switches it on.
- **Show.** View-only links for clients, invitations for collaborators, and a ZIP export of everything.

The rule that keeps it small: Moodloom holds and references work. The designing happens in the tools made for it.

## Repository

```
backend/     Node + Express + PostgreSQL API (also serves the built web app in production)
frontend/    React + Vite + Tailwind web app (installable as a PWA)
extension/   Chrome/Edge extension (Manifest V3)
docs/        Architecture, API, security, deployment, brand, AI report
```

## Run it locally

Full instructions, including Windows, are in [SETUP.md](SETUP.md). The short version:

```bash
# 1. API
cd backend
cp .env.example .env         # set DATABASE_URL and JWT_SECRET
npm install
npm run migrate
npm start                    # http://localhost:3001

# 2. Web app (second terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173

# 3. Optional: a ready-made demo project
cd backend && npm run demo:seed     # then log in as demo@moodloom.test / moodloom-demo
```

## Checks

```bash
cd backend && npm test        # 58 API tests against a real Postgres test database
cd frontend && npm run lint && npm run build
cd backend && npm run ai:eval # re-measures palette and similarity methods (docs/ai/RESULTS.md)
```

CI (`.github/workflows/ci.yml`) runs the tests, the build and a dependency audit on every push.

## Documentation

| | |
|---|---|
| [SETUP.md](SETUP.md) | Installing and running, step by step |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit and why |
| [docs/API.md](docs/API.md) | Every endpoint |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, what's defended, what isn't yet |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Putting it on the internet |
| [docs/BRAND.md](docs/BRAND.md) | Moodloom's identity and interface rules |
| [docs/ai/REPORT.md](docs/ai/REPORT.md) | The AI layer: methods, measurements, limits |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |

## Status

Version 3.0, pre-launch. Private repository; not open source. Built by Stedan Ampofo.
