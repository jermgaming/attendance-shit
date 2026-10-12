CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE session_status AS ENUM ('open', 'closed');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'excused');
CREATE TYPE marked_by_type AS ENUM ('student', 'teacher');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'student',
  roll_number text UNIQUE,
  section text,
  bound_device_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id),
  subject text NOT NULL,
  section text,
  status session_status NOT NULL DEFAULT 'open',
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  auto_close_at timestamptz,
  rotation_interval_seconds int NOT NULL DEFAULT 20 CHECK (rotation_interval_seconds BETWEEN 15 AND 30),
  rotation_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_open_session_per_teacher
  ON class_sessions (teacher_id) WHERE status = 'open';

CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id),
  student_id uuid NOT NULL REFERENCES users(id),
  status attendance_status NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  marked_by marked_by_type NOT NULL,
  ip_address inet,
  device_id text,
  code_window bigint,
  note text,
  UNIQUE (session_id, student_id)
);

CREATE INDEX idx_attendance_session ON attendance (session_id);
CREATE INDEX idx_attendance_student ON attendance (student_id);
CREATE INDEX idx_attendance_marked_at ON attendance (marked_at);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  session_id uuid,
  ip_address inet,
  device_id text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_session_action ON audit_log (session_id, action);
CREATE INDEX idx_audit_created_at ON audit_log (created_at);
