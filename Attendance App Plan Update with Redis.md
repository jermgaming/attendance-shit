# Attendance App: Plan Update with Redis

Redis handles the short-lived, fast-changing data. Postgres remains the permanent record. The split is simple: **if losing it would hurt, it goes in Postgres. If it expires anyway, it goes in Redis.**

## 1. What Redis Does in This App

| Use | How it works | Why Redis fits |
| --- | --- | --- |
| OTP codes | Store code against email with a 5-minute expiry | Auto-expires, no cleanup job |
| Rate limiting | Count OTP requests and login attempts per email and per IP | Fast counters with built-in expiry |
| Login sessions | Store session tokens so you can log out or revoke a student instantly | Easy to invalidate |
| Rotating session code | The code on the board changes every 30-60 seconds | Expiry handles the rotation |
| Live attendance cache | Keep a set of present students per open session for the dashboard | Fast counts and lookups |
| Duplicate-mark guard | Atomic add-to-set stops two quick taps from creating two records | Prevents race conditions |
| Email queue (optional) | Queue OTP emails so a slow SMTP server doesn't block the app, with retries | A queue library like BullMQ runs on Redis |
| Socket.IO adapter (optional) | Only needed if you run multiple app containers | Skip for a single container |

## 2. Updated Container List

- **app:** Node/Express plus the built React frontend
- **db:** PostgreSQL (permanent data)
- **redis:** Redis (temporary data and counters)
- **mail / adminer / backup:** optional, as before

Redis stays on the internal Docker network only, with no published port, same as Postgres.

## 3. Making Redis Data Persistent

Redis keeps data in memory, so persistence has to be switched on:

- Turn on **AOF (append-only file)**, which logs every write and gives the best durability. You can add RDB snapshots as a backup layer.
- Mount a **volume or bind mount** (for example `./data/redis`) for Redis's data directory.
- Set `restart: unless-stopped` and a healthcheck (a simple ping).
- Make the app wait for both Postgres and Redis to be healthy before starting.
- Set a **Redis password** through the `.env` file, even on the internal network.
- Set a memory limit so Redis can't use up the laptop's RAM.

Persistence matters most for sessions and the live set of marked students. OTPs and rotating codes can be lost on a restart without any real harm.

## 4. The Important Rule: Postgres Is the Source of Truth

- Every "Mark Present" is written to **Postgres**. Redis only speeds it up.
- If Redis is wiped or restarts empty, the app should **rebuild** the live present list for any open session from Postgres.
- Students may need to log in again if sessions are lost, but **no attendance record should ever be lost**.
- Never rely on Redis alone for anything you'd need in a report.

## 5. Updated Marking Flow

1. Student taps "Mark Present."
2. The server checks the login session in Redis.
3. The server checks the submitted code against the current rotating code in Redis.
4. The server tries to add the student to the session's present set in Redis. If already there, reject as a duplicate.
5. The server writes the record to Postgres (the unique constraint is a second safety net).
6. Socket.IO pushes the update to the teacher's dashboard.
7. When the session closes, the Redis keys for that session are cleared, since Postgres holds the final record.

## 6. Key Naming and Expiry Plan

Decide the key patterns upfront so the data stays organized:

- OTP per email: 5-minute expiry
- OTP attempt counter per email: 10-minute expiry
- Rate-limit counter per IP: short expiry
- Login session per token: expires after the day or semester you choose
- Current rotating code per session: 30-60 seconds
- Present set per session: cleared after the session closes (or after a safety expiry such as 24 hours)

## 7. Updated Build Order

1. Postgres with its volume and healthcheck (as before).
2. Add Redis with AOF, volume, password, and healthcheck. Confirm data survives `docker compose down` and `up`.
3. Containerize the backend and connect to both.
4. Move OTP storage and rate limiting to Redis.
5. Move login sessions to Redis.
6. Add the rotating code and the present-set logic.
7. Add the recovery step: on startup or session open, rebuild Redis state from Postgres.
8. Add the email queue (optional).
9. Test: restart Redis mid-session and confirm nothing permanent is lost.
10. Extend the backup job. Postgres is the priority; Redis's AOF folder can be copied too but isn't critical.

## 8. Things to Watch Out For

- **`down -v` wipes the Redis volume too.** Warn whoever runs it.
- **Don't store large or permanent data in Redis.** It's for small, expiring keys.
- **Clock accuracy matters** for OTP and rotating-code expiry, so keep the host machine's time correct.
- **Resource use:** Postgres and Redis together are light for a classroom, but still set the memory limit.
- **Skip Redis clustering or Sentinel.** A single instance is enough here.

## 9. Questions to Finalize

1. Do you want login sessions to last for the day, the week, or the semester?
2. Do you want a rotating code on the board, or is the logged-in email enough for marking?
3. Which OS will the host run (Windows, Mac, Linux)?
