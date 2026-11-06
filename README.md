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

---

## Architecture — High Level Design

The **Attendance Marking** system is a full-stack classroom attendance application. Teachers create timed sessions with rotating verification codes; students mark themselves present via a 6-digit code or QR scan (subject to network/device restrictions); real-time dashboards and projector screens display live attendance.

- **Frontend:** React + Vite SPA
- **Backend:** Node.js + Express REST API + Socket.io server
- **Database:** PostgreSQL (primary), Redis (caching, rate limits, rotating codes, present-sets)
- **Email:** SMTP via Nodemailer (OTP delivery)
- **Containerization:** Docker / Docker Compose

### Container-Level Diagram

```mermaid
C4Container
    title System Container Diagram - Attendance Marking

    Person(student, "Student", "Marks attendance via code/QR")
    Person(teacher, "Teacher", "Creates sessions, manages roster, views reports")
    Person(admin, "Admin", "System oversight, reports, user management")

    System_Boundary(c1, "Attendance App") {
        Container(frontend, "Frontend (React + Vite)", "JavaScript/React", "SPA - login, dashboards, scanner, projector screen")
        Container(backend, "Backend API (Node + Express)", "JavaScript", "REST API, auth, business logic, Socket.io server")
        ContainerDb(postgres, "PostgreSQL", "Relational DB", "Users, sessions, attendance, audit log")
        ContainerDb(redis, "Redis", "In-memory store", "Rotating codes, present-sets, rate limits, OTP state")
        Container(smtp, "SMTP Server", "Email", "OTP delivery via Nodemailer")
    }

    BiDir(student, frontend, "Uses", "HTTPS/WSS")
    BiDir(teacher, frontend, "Uses", "HTTPS/WSS")
    BiDir(admin, frontend, "Uses", "HTTPS/WSS")

    Rel(frontend, backend, "API calls (REST) + Socket.io events", "HTTP/JSON, WebSocket")
    Rel(backend, postgres, "Queries", "SQL (pg)")
    Rel(backend, redis, "Cache / pub-sub / state", "Redis (ioredis)")
    Rel(backend, smtp, "Sends OTP email", "SMTP")

    Rel_Neighbor(frontend, postgres, "No direct access", "None")
    Rel_Neighbor(frontend, redis, "No direct access", "None")
```

### Backend Component Diagram

```mermaid
graph TD
    subgraph HTTP Layer
        Entry[Express App]
        MW[Middleware: Auth, RBAC, Validate, RateLimit, Network/IP]
    end

    subgraph Route Controllers
        Auth[auth.js]
        Sessions[sessions.js]
        Mark[mark.js]
        Students[students.js]
        Reports[reports.js]
        Me[me.js]
        Health[health.js]
    end

    subgraph Service Layer
        AS[Attendance Service]
        AuS[Auth Session Service]
        OTS[OTP Service]
        RS[Rotation Service]
        FlS[Flag Service]
        AudS[Audit Service]
        MailS[Mail Service]
        SeedS[Seed Service]
    end

    subgraph Data Layer
        DB[(PostgreSQL)]
        RDS[(Redis)]
    end

    subgraph Real-Time
        IO[Socket.io Server]
        Emit[Emitter Utils]
    end

    Entry --> MW
    MW --> Auth & Sessions & Mark & Students & Reports & Me & Health

    Sessions --> AS
    Mark --> AS
    Mark --> RS
    Mark --> FlS
    Mark --> OTS
    Mark --> AudS
    Students --> AS
    Reports --> AS
    Auth --> AuS

    AS --> DB
    AS --> RDS
    RS --> RDS
    OTS --> RDS
    AudS --> DB

    IO -.-> Emit
    Emit -.-> Sessions
    Emit -.-> Mark
    Emit -.-> AS

    Entry -.-> IO
```

### Sequence Diagram — Student Marks Attendance

```mermaid
sequenceDiagram
    participant S as Student Browser
    participant F as Frontend (React)
    participant API as Express API
    participant R as Redis
    participant DB as PostgreSQL
    participant WS as Socket.io

    S->>F: Open scan page / enter 6-digit code
    F->>API: GET /api/v1/sessions/active (Bearer token)
    API->>DB: Query open session for student.section
    DB-->>API: Session row
    API-->>F: Session details + mark_mode
    F-->>S: Show active session + input field

    S->>F: Submit code
    F->>API: POST /api/v1/sessions/:id/mark { code }
    API->>API: Authenticate + role check (student)
    API->>R: GET code:current:<sessionId>, code:previous:<sessionId>
    R-->>API: Current/previous rotating code
    API->>R: INCR mark:attempts:<session>:<student> (rate limit)
    R-->>API: Attempt count
    alt Code invalid or rate limited
        API-->>F: 400/429 Error
        F-->>S: Show error
    else Code valid
        API->>R: SADD present:<sessionId> <studentId>
        R-->>API: Added count
        API->>DB: INSERT attendance (student, session, status=present, ip, device)
        DB-->>API: Inserted
        API->>WS: Emit to session:<id>:teacher room (attendance updated)
        WS-->>F: Real-time push (teacher dashboard / projector)
        API-->>F: 201 { status: present }
        F-->>S: Marked present confirmation
    end
```

### Sequence Diagram — Teacher Creates Session

```mermaid
sequenceDiagram
    participant T as Teacher Browser
    participant F as Frontend
    participant API as Express API
    participant DB as PostgreSQL
    participant RS as Rotation Service

    T->>F: Fill session form (subject, section, duration, mark mode)
    F->>API: POST /api/v1/sessions { subject, section, durationMinutes, markMode }
    API->>API: Authenticate + requireRole(teacher/admin)
    API->>DB: Check for existing open session for teacher
    DB-->>API: None (or conflict)
    API->>DB: INSERT class_sessions (teacher_id, subject, section, auto_close_at, rotation_interval_seconds, mark_mode)
    DB-->>API: Session created
    API-->>F: 201 Session object
    F-->>T: Session created, code rotation starts (every 15-30s)
    API->>RS: Initialize rotation timer for session
```

### Deployment View (Docker Compose)

```mermaid
graph TD
    subgraph Host Machine
        subgraph Docker Network
            LB[Reverse Proxy / Tunnel / LAN IP]
            BE[Backend Container<br/>Node.js Express + Socket.io]
            DB[Postgres Container<br/>+ init SQL migrations]
            RD[Redis Container<br/>+ AOF/RDB persistence]
        end
    end

    subgraph External
        Client[Student/Teacher Devices<br/>Web Browser]
        SMTP[External SMTP Server]
    end

    Client -->|HTTP/WSS| LB
    LB -->|HTTP/WSS| BE
    BE -->|SQL| DB
    BE -->|Redis| RD
    BE -->|SMTP| SMTP

    subgraph Backups
        BK[Backup Scripts + Dumps<br/>.sql + .rdb + .aof]
    end
    DB -.->|Periodic dumps| BK
    RD -.->|Periodic dumps| BK
```

### ASCII Architecture Overview

```
+---------------------+      HTTPS/WSS      +-----------------------------+
|   Client Devices    | <==================> |   Load Balancer / LAN IP   |
| (Student/Teacher)   |      (React SPA)     |   (optional tunnel/proxy)  |
+---------------------+                      +-----------------------------+
                                                         |
                                                         | HTTP/JSON + WS
                                                         v
                                               +-----------------------------+
                                               |   Backend (Node/Express)    |
                                               |  - Auth middleware          |
                                               |  - Route controllers        |
                                               |  - Socket.io server         |
                                               +-----------------------------+
                                                         |
          +------------------------------------------------+------------------------------------------------+
          | SQL (pg)                                       | Redis (ioredis)                               |
          v                                                v                                               v
   +--------------+                                +------------------+                           +--------------+
   | PostgreSQL   |                                | Rotating codes   |                           | Present sets |
   | - users      |                                | (current/prev)   |                           | (per session)|
   | - sessions   |                                | Rate-limit cnts  |                           | Rate-limit TT|
   | - attendance |                                | OTP state        |                           +--------------+
   | - audit_log  |                                +------------------+
   +--------------+
          |
          | SMTP
          v
   +--------------+
   | SMTP Server  |  (OTP delivery)
   +--------------+
```

### Data Model (PostgreSQL)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Students, teachers, admins | `id`, `email`, `name`, `role` (enum), `roll_number`, `section`, `bound_device_id`, `is_active` |
| `class_sessions` | Open class session owned by a teacher | `id`, `teacher_id`, `subject`, `section`, `status` (open/closed), `auto_close_at`, `rotation_interval_seconds`, `rotation_paused`, `mark_mode` |
| `attendance` | One record per student per session | `id`, `session_id`, `student_id`, `status` (present/absent/excused), `marked_at`, `marked_by`, `ip_address`, `device_id`, `code_window`, `note` |
| `audit_log` | Immutable action log | `id`, `actor_id`, `action`, `session_id`, `ip_address`, `device_id`, `meta` (jsonb), `created_at` |

**Constraints:**
- One open session per teacher (unique partial index on `teacher_id WHERE status = 'open'`)
- One attendance record per student per session (`UNIQUE(session_id, student_id)`)

### Key Features

#### Session Lifecycle (Teacher)
- Create session with subject, section, duration, rotation interval, mark mode (`code` or `qr`)
- Only one open session per teacher at a time
- Auto-close after configured duration
- Pause/resume code rotation, force-rotate now, close early
- `recoverOpenSessions()` rehydrates open sessions after server restart

#### Attendance Marking (Student)
- View active session filtered by student's section
- Submit 6-digit rotating code (Redis stores `current` + `previous` for clock-skew tolerance)
- IP subnet allowlist (`ALLOWED_SUBNETS`) and optional device binding (`bound_device_id`)
- Rate-limited: max 5 mark attempts per minute per session+student
- Result written to Redis set `present:<sessionId>` and PostgreSQL
- Real-time Socket.io push to teacher/projector rooms

#### Mark Modes
- `code`: Student types a rotating 6-digit code
- `qr`: QR-based marking (frontend `QrScanner` component)

#### Roster Management (Teacher/Admin)
- CRUD for students
- Bulk import via CSV/Excel upload

#### Reports
- Per-student attendance history with attended/total/percentage
- Summary report with filters (section, subject, date range)
- CSV export

#### Real-Time (Socket.io)
- Authenticated WebSocket connections
- Rooms: `role:<role>`, `session:<id>`, `session:<id>:teacher`
- Live attendance updates pushed to dashboards and projector screens

#### Security & Observability
- JWT/session token via `Authorization: Bearer` or HTTP-only cookie
- Role-based access control (`student`, `teacher`, `admin`)
- Helmet security headers, CORS-aware static serving
- OTP step-up authentication (optional)
- Audit logging for sensitive actions
- Rate limiting on OTP requests and mark attempts

### Project Structure

```
attendence-marking/
├── backend/
│   └── src/
│       ├── index.js            # Express app entry + server boot
│       ├── config.js           # Environment configuration
│       ├── db/                 # PostgreSQL pool + migrations
│       ├── middleware/         # Auth, RBAC, validation, rate limit, IP, errors
│       ├── routes/             # auth, sessions, mark, students, me, reports, health
│       ├── services/           # attendance, authSession, otp, rotation, flags, audit, mail, seed
│       ├── sockets/            # Socket.io setup + emitter utilities
│       └── utils/              # error helpers, IP helpers
├── frontend/
│   └── src/
│       ├── api.js, auth.jsx, socket.js
│       ├── App.jsx, main.jsx
│       ├── pages/              # Login, StudentHome, TeacherDashboard, History, ScanPage, ProjectorScreen
│       └── components/         # QrScanner, LiveSession, ReportsPanel, RosterManager, SessionsList
├── CY-AIC / CY-AIMLC/          # Excel/CSV to JSON import utilities
├── docker-compose.yml, Dockerfile
├── .env, .env.example
├── Attendance App API Specification.md
├── Attendance App Plan Update with Redis.md
└── README.md                   # This document
```

### Key Design Decisions

| Concern | Decision |
|---------|----------|
| **Auth** | JWT/session token via `Authorization: Bearer` or HTTP-only cookie (`session`) |
| **Roles** | `student`, `teacher`, `admin` enforced via route middleware |
| **Real-time** | Socket.io rooms: `role:<role>`, `session:<id>`, `session:<id>:teacher` |
| **Code rotation** | Redis stores current + previous 6-digit code; rotates every 15–30s |
| **Deduplication** | Redis `SADD present:<sessionId>` + Postgres `UNIQUE(session_id, student_id)` |
| **Security** | IP subnet allowlist, optional device binding, OTP step-up, audit logging |
| **Recovery** | `recoverOpenSessions()` rehydrates open sessions after restart |
| **Backend framework** | Express (REST) + Socket.io (WebSockets) |
| **Database** | PostgreSQL (primary), Redis (state/cache) |
