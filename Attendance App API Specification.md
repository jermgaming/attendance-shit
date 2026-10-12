# Attendance App: API Specification

This document is the build spec for a classroom attendance system. Hand it to the coding agent as the single source of truth. Where it says MUST, the behavior is required; where it says SHOULD, it is a default that may be adjusted.

## 1. System Summary

Students log in with their college email (verified by an emailed one-time code), then mark themselves present during an open class session by typing a rotating code shown on the teacher's screen. The teacher sees a live attendance list. Everything runs locally in Docker on one machine, and students reach it over the classroom Wi-Fi.

### Stack

- Backend: Node.js (LTS) with Express and Socket.IO
- Database: PostgreSQL (permanent data, source of truth)
- Cache and short-lived data: Redis with AOF persistence and a password
- Frontend: React (Vite), built in a multi-stage Docker build and served as static files by Express from the same container
- Email: Nodemailer over external SMTP (Mailpit in development)
- Containers: app, db, redis, plus optional adminer, backup and mailpit
- Only the app port is published to the host. Postgres and Redis stay on the internal Docker network.

### Golden rule

Every attendance mark MUST be written to Postgres. Redis only accelerates it. If Redis is empty after a restart, the server MUST rebuild any open session's live state from Postgres. No attendance record may ever exist only in Redis.

## 2. Conventions

- Base path: `/api/v1`
- Format: JSON request and response bodies, UTF-8. File upload endpoints use `multipart/form-data`.
- Timestamps: ISO 8601 in UTC (for example `2026-10-09T09:30:00Z`). The container time zone is set to the local zone for display and exports only.
- IDs: UUIDs.
- Auth header: `Authorization: Bearer <token>` on every endpoint except those marked Public.
- Device header: `X-Device-Id: <string>` sent by the frontend on every request. It is a random ID generated once and stored in the browser's local storage.
- Pagination: `?page=1&pageSize=50` on list endpoints. Response includes `page`, `pageSize`, `total`.
- Roles: `student`, `teacher`, `admin`. Admin can do everything a teacher can.

### Standard error format

All errors MUST use this shape:

```json
{
  "error": {
    "code": "SESSION_CLOSED",
    "message": "This attendance session is closed.",
    "details": {}
  }
}
```

### Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | VALIDATION\_ERROR | Missing or malformed field |
| 401 | UNAUTHENTICATED | No token, bad token, or expired session |
| 403 | FORBIDDEN | Role not allowed |
| 403 | EMAIL\_DOMAIN\_NOT\_ALLOWED | Email domain is not the college domain |
| 403 | NOT\_IN\_ROSTER | Email is not on the student roster |
| 403 | NETWORK\_NOT\_ALLOWED | Request IP is outside the allowed subnet |
| 403 | DEVICE\_MISMATCH | Student is bound to a different device |
| 404 | NOT\_FOUND | Resource does not exist |
| 409 | ALREADY\_MARKED | Student already marked present in this session |
| 409 | SESSION\_CLOSED | Session is not open |
| 409 | SESSION\_ALREADY\_OPEN | Teacher already has an open session |
| 422 | INVALID\_CODE | Rotating code is wrong or expired |
| 422 | INVALID\_OTP | Login code is wrong or expired |
| 429 | RATE\_LIMITED | Too many requests or attempts. Includes `retryAfterSeconds` in details. |
| 500 | INTERNAL\_ERROR | Unexpected failure |

## 3. Data Model (PostgreSQL)

### users

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, pk |  |
| email | text, unique, lowercase | College email |
| name | text |  |
| role | enum(student, teacher, admin) |  |
| roll\_number | text, nullable, unique | Students only |
| section | text, nullable | For example "CSE-A" |
| bound\_device\_id | text, nullable | Set on first login when device binding is on |
| is\_active | boolean, default true |  |
| created\_at, updated\_at | timestamptz |  |

### class\_sessions

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, pk |  |
| teacher\_id | uuid, fk users |  |
| subject | text |  |
| section | text, nullable | Limits which students may mark. Null means any rostered student. |
| status | enum(open, closed) |  |
| started\_at | timestamptz |  |
| closed\_at | timestamptz, nullable |  |
| auto\_close\_at | timestamptz, nullable |  |
| rotation\_interval\_seconds | int, default 20 | Allowed 15 to 30 |
| rotation\_paused | boolean, default false |  |
| created\_at | timestamptz |  |

A partial unique index MUST ensure one open session per teacher.

### attendance

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, pk |  |
| session\_id | uuid, fk class\_sessions |  |
| student\_id | uuid, fk users |  |
| status | enum(present, absent, excused) |  |
| marked\_at | timestamptz |  |
| marked\_by | enum(student, teacher) |  |
| ip\_address | inet |  |
| device\_id | text |  |
| code\_window | bigint | Identifier of the rotating-code window used |
| note | text, nullable | Reason for a teacher override |

A unique constraint on (session\_id, student\_id) MUST exist as the final duplicate guard.

### audit\_log

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, pk |  |
| actor\_id | uuid, nullable |  |
| action | text | For example LOGIN, MARK, OVERRIDE, SESSION\_OPEN, SESSION\_CLOSE, FLAG |
| session\_id | uuid, nullable |  |
| ip\_address, device\_id | inet, text |  |
| meta | jsonb |  |
| created\_at | timestamptz |  |

## 4. Redis Keys and Expiry

| Key pattern | Value | TTL |
| --- | --- | --- |
| `otp:{email}` | Hashed 6-digit code | 5 minutes |
| `otp:attempts:{email}` | Counter | 10 minutes |
| `otp:requests:{email}` | Counter of codes requested | 15 minutes |
| `rl:ip:{ip}:{route}` | Request counter | 1 minute |
| `auth:session:{tokenId}` | userId, role, deviceId | `SESSION_TTL_HOURS` (default 12) |
| `auth:user-sessions:{userId}` | Set of tokenIds | Same as session |
| `code:current:{sessionId}` | Current 6-digit code | Interval + 5 seconds |
| `code:previous:{sessionId}` | Previous code | Interval + 5 seconds |
| `code:window:{sessionId}` | Current window number | Interval + 5 seconds |
| `mark:attempts:{sessionId}:{studentId}` | Wrong-code counter | 1 minute |
| `present:{sessionId}` | Set of studentIds | Until session close, safety expiry 24 hours |
| `stepup:{userId}` | Fresh-OTP proof (optional feature) | 2 minutes |

Never store an OTP in plain text. Store a hash and compare using constant-time comparison.

## 5. Authentication Rules

- Only emails ending in `ALLOWED_EMAIL_DOMAIN` are accepted.
- A student MUST exist in the roster to log in. Teachers and admins are matched against `TEACHER_EMAILS` and `ADMIN_EMAILS` environment lists (seeded into the users table on startup).
- An OTP is 6 digits, valid for 5 minutes, single use, with at most 5 wrong attempts before it is invalidated.
- At most 3 OTP requests per email per 15 minutes, and at most 10 per IP per minute.
- The login token is an opaque random token or a JWT whose ID is also stored in Redis, so that logout and revocation take effect immediately.
- If `ENABLE_DEVICE_BINDING` is true, the first login binds the student to the `X-Device-Id`. Later logins from another device are rejected with `DEVICE_MISMATCH` until an admin or teacher resets the binding.

## 6. REST Endpoints

### 6.1 Health

**GET `/api/v1/health`** (Public)

Returns `200` with `{ "status": "ok", "db": "up", "redis": "up", "time": "..." }`. Used for Docker healthchecks.

### 6.2 Auth

**POST `/api/v1/auth/otp/request`** (Public)

Request:

```json
{ "email": "student@college.edu" }
```

Behavior: validate domain and roster, generate the OTP, store its hash in Redis, queue the email. To avoid revealing which emails are registered, the response is always the same when the domain is allowed.

Response `200`:

```json
{ "message": "If this email is registered, a code has been sent.", "expiresInSeconds": 300 }
```

Errors: `VALIDATION_ERROR`, `EMAIL_DOMAIN_NOT_ALLOWED`, `RATE_LIMITED`.

**POST `/api/v1/auth/otp/verify`** (Public)

Request:

```json
{ "email": "student@college.edu", "code": "482913" }
```

Behavior: check the code, apply device binding, create the session in Redis, write a LOGIN audit entry.

Response `200`:

```json
{
  "token": "opaque-or-jwt",
  "expiresAt": "2026-10-09T21:30:00Z",
  "user": { "id": "uuid", "name": "Asha Rao", "email": "student@college.edu", "role": "student", "rollNumber": "21CS042" }
}
```

Errors: `INVALID_OTP`, `RATE_LIMITED`, `NOT_IN_ROSTER`, `DEVICE_MISMATCH`.

**POST `/api/v1/auth/logout`** (Any role)

Deletes the current session from Redis. Response `204`.

**GET `/api/v1/auth/me`** (Any role)

Response `200`: the current `user` object plus `{ "deviceBound": true }`.

**POST `/api/v1/auth/step-up/request`** and **POST `/api/v1/auth/step-up/verify`** (Student, optional)

Only active when `REQUIRE_FRESH_OTP_ON_MARK=true`. Works like the login OTP but for an already logged-in student. A successful verify stores `stepup:{userId}` in Redis for 2 minutes, and the next mark request consumes it. Response of verify: `{ "stepUpValidSeconds": 120 }`.

### 6.3 Students and Roster (Teacher, Admin)

**POST `/api/v1/students/import`**

`multipart/form-data` with a CSV file under field `file`. Required columns: `name`, `email`, `roll_number`. Optional: `section`.

Behavior: validate every row, skip duplicates by email (update name and section), reject rows with a wrong domain. Process in a single transaction.

Response `200`:

```json
{ "imported": 58, "updated": 2, "skipped": 1, "errors": [ { "row": 14, "reason": "EMAIL_DOMAIN_NOT_ALLOWED" } ] }
```

**GET `/api/v1/students`**

Query: `section`, `search`, `page`, `pageSize`. Returns the paginated list of students.

**POST `/api/v1/students`**

Body: `{ name, email, rollNumber, section }`. Response `201` with the created student.

**PATCH `/api/v1/students/:id`**

Body: any of `name`, `rollNumber`, `section`, `isActive`. Response `200`.

**DELETE `/api/v1/students/:id`**

Soft delete by setting `isActive=false`, since attendance history must be kept. Response `204`.

**POST `/api/v1/students/:id/reset-device`**

Clears `bound_device_id` and revokes the student's live sessions. Response `204`.

### 6.4 Class Sessions (Teacher, Admin)

**POST `/api/v1/sessions`**

Request:

```json
{
  "subject": "Data Structures",
  "section": "CSE-A",
  "durationMinutes": 60,
  "rotationIntervalSeconds": 20
}
```

Behavior: create an open session, set `auto_close_at`, generate the first code, start the rotation job, and fill `present:{sessionId}` as empty. Emit `session:opened` over Socket.IO.

Response `201`:

```json
{
  "id": "uuid", "subject": "Data Structures", "section": "CSE-A",
  "status": "open", "startedAt": "...", "autoCloseAt": "...",
  "rotationIntervalSeconds": 20
}
```

Errors: `VALIDATION_ERROR` (interval outside 15 to 30), `SESSION_ALREADY_OPEN`.

**GET `/api/v1/sessions`**

Query: `status`, `from`, `to`, `subject`, `page`, `pageSize`. Lists the teacher's sessions (admin sees all).

**GET `/api/v1/sessions/:id`**

Returns the session plus counts: `presentCount`, `rosterCount`.

**PATCH `/api/v1/sessions/:id/close`**

Behavior: set status closed, stop rotation, mark all unmarked rostered students as `absent` in Postgres, delete the session's Redis keys, emit `session:closed`. Response `200` with the final counts. Closing an already closed session returns `SESSION_CLOSED`.

**PATCH `/api/v1/sessions/:id/rotation`**

Request (any subset):

```json
{ "paused": true, "intervalSeconds": 25, "rotateNow": true }
```

Behavior: pause or resume rotation, change the interval (15 to 30), or force an immediate new code. Response `200` with the current rotation settings.

**GET `/api/v1/sessions/:id/code`** (Teacher, Admin)

Returns what the projector screen needs:

```json
{ "code": "739204", "validForSeconds": 14, "intervalSeconds": 20, "windowId": 84210 }
```

The screen normally receives updates through Socket.IO and uses this endpoint only for the first load or a reconnect.

### 6.5 Student Marking

**GET `/api/v1/sessions/active`** (Student)

Returns the open session the student is eligible for (matching section), or `404 NOT_FOUND` if none.

```json
{ "id": "uuid", "subject": "Data Structures", "teacherName": "Dr. Mehta", "startedAt": "...", "alreadyMarked": false }
```

**POST `/api/v1/sessions/:id/mark`** (Student)

Request:

```json
{ "code": "739204" }
```

Validation order (stop at the first failure):

1. Valid login session in Redis
2. Session exists and is open
3. Request IP is inside `ALLOWED_SUBNETS` (if configured)
4. Student belongs to the session's section (if one is set)
5. Device matches the student's bound device (if binding is on)
6. Fresh-OTP proof present (only if `REQUIRE_FRESH_OTP_ON_MARK=true`)
7. Wrong-attempt limit not exceeded (5 per minute per student per session)
8. Code equals `code:current` or `code:previous` for the session
9. Atomic add to `present:{sessionId}`. If the student is already in the set, return `ALREADY_MARKED`.
10. Insert into Postgres `attendance`. On a unique-constraint violation, return `ALREADY_MARKED`. If the insert fails for any other reason, remove the student from the Redis set again.
11. Write a MARK audit entry, run the proxy checks in section 8, and emit `attendance:marked`.

Response `201`:

```json
{ "status": "present", "markedAt": "2026-10-09T09:41:12Z", "subject": "Data Structures" }
```

Errors: `UNAUTHENTICATED`, `SESSION_CLOSED`, `NETWORK_NOT_ALLOWED`, `FORBIDDEN`, `DEVICE_MISMATCH`, `INVALID_CODE`, `RATE_LIMITED`, `ALREADY_MARKED`.

### 6.6 Live Attendance (Teacher, Admin)

**GET `/api/v1/sessions/:id/attendance`**

Query: `status` (present, absent, all), `search`.

```json
{
  "sessionId": "uuid",
  "counts": { "present": 42, "absent": 16, "total": 58 },
  "students": [
    { "studentId": "uuid", "name": "Asha Rao", "rollNumber": "21CS042", "email": "...", "status": "present", "markedAt": "...", "markedBy": "student", "flagged": false }
  ]
}
```

For an open session, `present` comes from Redis for speed, and the absent list is the roster minus the present set. If Redis has no data for the session, rebuild it from Postgres first.

**PATCH `/api/v1/sessions/:id/attendance/:studentId`**

Teacher override.

Request:

```json
{ "status": "present", "note": "Marked on paper, phone died" }
```

Behavior: upsert the attendance row with `marked_by=teacher`, update the Redis set, write an OVERRIDE audit entry, emit `attendance:updated`. Works on open and closed sessions. Response `200` with the updated row.

**GET `/api/v1/sessions/:id/flags`**

Returns suspicious-activity flags for the session (see section 8).

```json
{ "flags": [ { "type": "SHARED_IP", "studentIds": ["uuid", "uuid"], "detail": "2 marks within 6 seconds from 192.168.1.41" } ] }
```

**GET `/api/v1/sessions/:id/export`**

Query: `format=csv` (default) or `xlsx`. Returns a file download. Columns: roll number, name, email, status, marked at, marked by, note.

### 6.7 Student History (Student)

**GET `/api/v1/me/attendance`**

Query: `from`, `to`, `subject`, `page`, `pageSize`. Returns the student's own records, one row per session.

**GET `/api/v1/me/attendance/summary`**

```json
{ "overall": { "attended": 34, "total": 40, "percentage": 85.0 },
  "bySubject": [ { "subject": "Data Structures", "attended": 12, "total": 14, "percentage": 85.7 } ] }
```

### 6.8 Reports (Teacher, Admin)

**GET `/api/v1/reports/students/:id`**: attendance history and percentages for one student.

**GET `/api/v1/reports/summary`**: query `section`, `subject`, `from`, `to`. Returns per-student attendance percentages and lists students below a threshold (`?below=75`). Supports `format=csv`.

## 7. Socket.IO (Real-Time)

- Endpoint: same origin as the app, path `/socket.io`.
- Connection auth: the client sends the login token in the handshake (`auth: { token }`). The server MUST reject unauthenticated connections.
- Rooms: the server places each connection in `session:{id}` rooms as follows. A teacher joins their session's room by emitting `session:join`. A student is placed in the room of their active session automatically.

### Server to client events

| Event | Sent to | Payload |
| --- | --- | --- |
| `session:opened` | Students (eligible section) | `{ sessionId, subject, teacherName }` |
| `session:closed` | Session room | `{ sessionId, counts }` |
| `code:updated` | Teacher only | `{ sessionId, code, validForSeconds, intervalSeconds, windowId }` |
| `attendance:marked` | Teacher only | `{ sessionId, student: { id, name, rollNumber }, markedAt, counts }` |
| `attendance:updated` | Teacher only | `{ sessionId, studentId, status, counts }` |
| `flag:raised` | Teacher only | `{ sessionId, type, studentIds, detail }` |

The rotating code MUST NEVER be sent to a student's socket or returned to a student endpoint.

### Client to server events

| Event | From | Payload |
| --- | --- | --- |
| `session:join` | Teacher | `{ sessionId }` |
| `session:leave` | Teacher | `{ sessionId }` |

On reconnect, the client calls the REST endpoints above to resync, rather than relying on missed socket events.

## 8. Rotating Code and Proxy Protection Logic

### Code rotation

- A rotation job runs per open session every `rotation_interval_seconds`.
- Each new code is 6 digits from a cryptographically secure random source. It MUST NOT be derived from the clock or from the previous code.
- On rotation: copy `code:current` to `code:previous`, write the new `code:current`, increase `code:window`, and emit `code:updated` to the teacher.
- The server accepts the current or the previous code only. The server's clock alone decides validity.
- On startup, the server MUST restart rotation for every session still marked open in Postgres, and close sessions whose `auto_close_at` has passed.
- When a session closes, stop its rotation and delete its code keys.

### Flags raised for the teacher

- `SHARED_IP`: two or more different students marked from the same IP within 15 seconds.
- `SHARED_DEVICE`: two or more different students marked from the same device ID in one session.
- `LAST_SECOND`: a student repeatedly marking within the final few seconds of the session across several sessions (computed in the report job).
- `CODE_FAILURES`: a student with 5 or more wrong codes in one session.

Flags are stored in `audit_log` with action `FLAG` and shown through `GET /sessions/:id/flags`.

## 9. Security Requirements

- Hash OTPs. Use constant-time comparison.
- Use a strong random `JWT_SECRET` or token generator, loaded from the environment.
- Enable `helmet` and a strict CORS policy (same origin only).
- Validate every request body with a schema library (for example Zod or Joi).
- Use parameterized queries or an ORM only. Never build SQL from strings.
- Never log OTPs, tokens or the rotating code.
- Respect `X-Forwarded-For` only if `TRUST_PROXY=true`.
- Role checks MUST run in middleware on every protected route. A student token must never reach teacher endpoints.
- Students may only read their own attendance records.

## 10. Environment Variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `PORT` | App port | `3000` |
| `DATABASE_URL` | Postgres connection | `postgres://app:pass@db:5432/attendance` |
| `REDIS_URL` | Redis connection with password | `redis://:pass@redis:6379` |
| `ALLOWED_EMAIL_DOMAIN` | College email domain | `college.edu` |
| `TEACHER_EMAILS` | Comma-separated teacher emails | `a@college.edu,b@college.edu` |
| `ADMIN_EMAILS` | Comma-separated admin emails | `admin@college.edu` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Outgoing mail |  |
| `JWT_SECRET` | Token signing secret | long random string |
| `SESSION_TTL_HOURS` | Login lifetime | `12` |
| `ROTATION_INTERVAL_DEFAULT` | Default seconds | `20` |
| `ALLOWED_SUBNETS` | Optional classroom subnets | `192.168.1.0/24` |
| `ENABLE_DEVICE_BINDING` | Bind student to first device | `true` |
| `REQUIRE_FRESH_OTP_ON_MARK` | Optional step-up OTP | `false` |
| `TRUST_PROXY` | Trust forwarded IP header | `false` |
| `TZ` | Container time zone | `Asia/Kolkata` |

Provide a `.env.example` with placeholders and add `.env` to `.gitignore`.

## 11. Docker and Deployment Requirements

- `docker-compose.yml` defines `app`, `db`, `redis`, and optional `adminer`, `mailpit`, `backup`.
- Postgres data in a bind mount or named volume. Redis in a volume with AOF enabled and a password.
- Healthchecks on `db` and `redis`. The app uses `depends_on` with `condition: service_healthy`.
- `restart: unless-stopped` on every service.
- Only the app's port is published. `db` and `redis` have no published ports.
- Multi-stage Dockerfile: stage one builds the React app, stage two copies the build into the Node image and serves it.
- Database migrations run automatically on app startup, and a first admin and the configured teachers are seeded.
- Redis memory limit set in the compose file.
- Backup job runs `pg_dump` daily and after each session closes, keeps the last N days, and writes to a host folder.
- The app logs its LAN address on startup and exposes it so the teacher screen can show a QR code.

## 12. Suggested Project Structure

- `backend/src/routes` for the endpoint groups above (auth, students, sessions, mark, reports)
- `backend/src/services` for OTP, rotation, attendance, flags and mail
- `backend/src/middleware` for auth, role checks, rate limiting, network and device checks, validation
- `backend/src/db` for migrations and queries
- `backend/src/sockets` for Socket.IO setup
- `frontend/src/pages` for Login, StudentHome, TeacherDashboard, ProjectorScreen, History, Reports
- `docker-compose.yml`, `.env.example`, `README.md`

## 13. Build Order for the Coding Agent

1. Docker Compose with Postgres and Redis, volumes, healthchecks. Confirm data survives restart.
2. Backend skeleton, config loading, migrations, health endpoint.
3. Roster import and the users table.
4. OTP login, Redis sessions, auth middleware, rate limiting.
5. Class sessions: create, list, close, auto-close.
6. Rotation job, code endpoint, projector Socket.IO events.
7. Mark endpoint with the full validation order and duplicate guards.
8. Live attendance list, override, and Redis rebuild from Postgres.
9. Device binding, subnet check, flags.
10. History, reports and exports.
11. React frontend: login, student marking page, teacher dashboard, projector screen with QR code.
12. Multi-stage build, backup job, restart tests.
13. Test with many real phones, slow connections, Redis restart mid-session, and refresh during marking.

## 14. Acceptance Checklist

- A student cannot log in with a non-college email or an email missing from the roster.
- A student can mark present only while a session is open, with a valid current or previous code.
- A second mark by the same student returns `ALREADY_MARKED`, including under two rapid taps.
- The rotating code never appears in any student-facing response or socket event.
- Restarting Redis mid-session loses no attendance record and the live list rebuilds from Postgres.
- Restarting all containers keeps all data and resumes rotation for sessions still open.
- The teacher dashboard updates within about a second of a student marking.
- Closing a session marks every unmarked rostered student absent and stops further marks.
- Exports match the dashboard exactly.
- Postgres and Redis ports are not reachable from another device on the network.
