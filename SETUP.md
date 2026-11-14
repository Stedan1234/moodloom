# Setting up Moodloom

You need **Node.js 20 or newer** and **PostgreSQL 14 or newer**. Commands are the same on Windows (PowerShell), macOS and Linux unless noted.

## 1. Database

Create a database and a user for it (once):

```sql
CREATE USER moodloom WITH PASSWORD 'choose-a-password';
CREATE DATABASE moodloom OWNER moodloom;
```

## 2. API

```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

- `DATABASE_URL=postgresql://moodloom:choose-a-password@localhost:5432/moodloom`
- `JWT_SECRET=` a long random string. Generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
  The server refuses to start with the placeholder.

Then:

```bash
npm run migrate     # creates or updates the tables; safe to run any time
npm start           # leave this running
```

`http://localhost:3001/api/health` should answer `{"ok":true,...}`.

**Every time you pull new code**, run `npm install` and `npm run migrate` again before `npm start`.

## 3. Web app

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server passes `/api` and `/uploads` through to the API, so there is nothing else to configure.

## 4. Browser extension (Chrome or Edge)

1. Go to `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and pick the `extension/` folder.
2. In Moodloom, open **Account → Browser extension → Get a pairing code**.
3. Click the Moodloom icon in the browser toolbar and type the code. Leave the address blank when Moodloom runs on this computer.

After pulling an update, press the reload arrow on the extension's card in `chrome://extensions`.

## 5. Optional extras

| What | How |
|---|---|
| Demo project with drawn references | `cd backend && npm run demo:seed`, then log in as `demo@moodloom.test` / `moodloom-demo` |
| Direction notes (AI) | Put a key from console.anthropic.com in `ANTHROPIC_API_KEY`, restart the API, then switch it on per project under **Direction** |
| Search by description (CLIP) | `npm install @huggingface/transformers` in `backend/`, set `AI_EMBEDDER=clip`. Downloads about 350 MB on first use. Not yet tested end to end. |
| Real password-reset emails | Fill in the `SMTP_*` settings. Without them the reset link is printed in the API's console. |
| Forgot your own local password | `npm run reset-password -- you@example.com NewPassword123` |
| Give an account the Pro plan | `npm run set-plan -- you@example.com pro` |

## 6. Tests

The tests use their own database so they never touch your data:

```sql
CREATE DATABASE moodloom_test OWNER moodloom;
```

```bash
cd backend
TEST_DATABASE_URL=postgresql://moodloom:choose-a-password@localhost:5432/moodloom_test npm test
# PowerShell: $env:TEST_DATABASE_URL="postgresql://..."; npm test
```

## Troubleshooting

- **"Can't reach Moodloom" in the web app**: the API isn't running. Start it in `backend/` and leave that terminal open.
- **Server won't start, mentions JWT_SECRET**: set a real secret in `.env`.
- **Tables or columns missing after a pull**: run `npm run migrate`.
- **`sharp` fails to install on Windows**: use a current Node LTS (20 or 22); sharp ships prebuilt binaries for those.
- **Extension says it can't reach the server**: check the address typed at pairing; it must be the API's address (`http://localhost:3001` locally), not the web app's.
