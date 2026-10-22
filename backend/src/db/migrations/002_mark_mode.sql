ALTER TABLE class_sessions
  ADD COLUMN mark_mode text NOT NULL DEFAULT 'code'
  CHECK (mark_mode IN ('code', 'qr'));
