# Attendance App

Classroom attendance over the local network. Students log in with their college email (6-digit emailed code), mark themselves present by typing the rotating code shown on the teacher's projector, and the teacher watches the live list. Postgres is the source of truth for every mark; Redis holds expiring, fast-changing data (OTPs, sessions, rotating codes, live present set).

## Quick start (Docker)

1. Copy `.env.example` to `.env` and fill in the passwords, the college domain, and teacher/admin emails.
2. Build and start:

   ```bash
   docker compose up -d --build
   ```

3. Open `http://localhost:3000` (dev extras: `docker compose --profile dev --profile tools up -d` starts Mailpit on `:8025` and Adminer on `:8080`).

Only the app port is published. Postgres and Redis live on the internal network.

## How it works

- **Login**: `POST /api/v1/auth/otp/request` emails a 6-digit code (5 min, 5 wrong attempts invalidates, 3 requests / 15 min per email, 10 / min per IP). `verify` returns an opaque token stored in Redis (`SESSION_TTL_HOURS`).
- **Sessions**: a teacher opens one session at a time (partial unique index enforces it). A 6-digit code rotates every 15–30 s; only current or previous code is accepted. The code never reaches any student endpoint or socket event. Two marking modes per session (`MARK_MODE_DEFAULT` in `.env` sets the default): **Type code** (students type the rotating code) or **Scan QR** (the projector shows a QR encoding `/scan?s=<sessionId>&c=<code>`; scanning it marks the student instantly — the QR changes with each rotation).
- **Marking**: the full validation order is in the API spec (session open → subnet → section → device → step-up OTP → attempt limit → code → atomic `SADD` → Postgres insert with unique(session_id, student_id) as the final guard).
- **Golden rule**: every mark goes to Postgres. If Redis restarts empty, open sessions rebuild their live present set from Postgres; rotation resumes on app startup.
- **Flags**: `SHARED_IP`, `SHARED_DEVICE`, `CODE_FAILURES` are stored in `audit_log` (action `FLAG`) and surfaced at `GET /api/v1/sessions/:id/flags`. `LAST_SECOND` (cross-session pattern) is left to a report job.
- **Backups**: the `backup` container runs `pg_dump` daily and on every session close (trigger file in `./backups`), keeping the last `BACKUP_KEEP_DAYS`, plus a best-effort copy of the Redis AOF data (Postgres is the source of truth, so Redis snapshots are only a convenience).

## Project layout

- `backend/src/db` – pool, migrations (`001_init.sql`), query helpers
- `backend/src/middleware` – auth, roles, rate limiting, network check, validation, errors
- `backend/src/services` – OTP, auth sessions, rotation, attendance, flags, mail, seed
- `backend/src/routes` – auth, students, sessions, mark, me, reports
- `backend/src/sockets` – Socket.IO auth, rooms, events
- `frontend/src/pages` – Login, StudentHome, TeacherDashboard, ProjectorScreen, History
- `backup/backup.sh` – pg_dump job

## Local dev (no Docker)

Keep `docker compose up -d` running for Postgres (published on `127.0.0.1:5433`) and Redis (`127.0.0.1:6379`). The backend auto-loads the repo-root `.env`, which already points `DATABASE_URL`/`REDIS_URL` at those ports. Then:

```bash
cd backend && npm install && npm run dev      # http://localhost:3000
cd frontend && npm install && npm run dev     # vite proxy on :5173 -> :3000
```

## Notes and warnings

- **`docker compose down -v` wipes the Postgres and Redis volumes.** Backups are in `./backups`.
- OTPs, tokens and rotating codes are never logged.
- Keep the host clock correct; OTP and code validity depend on it.
