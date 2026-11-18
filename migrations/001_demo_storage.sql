-- Explicit migration. Never run automatically during application startup/build.
CREATE TABLE tutor_schema_version (version integer PRIMARY KEY);
INSERT INTO tutor_schema_version VALUES (1);
CREATE TABLE tutor_control (id integer PRIMARY KEY CHECK (id = 1), blocked_until timestamptz NOT NULL DEFAULT '-infinity');
INSERT INTO tutor_control(id) VALUES (1);
CREATE TABLE tutor_blobs (
 key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
 audio bytea NOT NULL CHECK (octet_length(audio) BETWEEN 44 AND 4000000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tutor_lessons (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
 data jsonb NOT NULL CHECK (octet_length(data::text) <= 1000000),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE TABLE tutor_lesson_blobs (
 lesson_id text REFERENCES tutor_lessons(id) ON DELETE CASCADE,
 blob_key text REFERENCES tutor_blobs(key),
 PRIMARY KEY (lesson_id, blob_key)
);
CREATE TABLE tutor_speech (
 key text PRIMARY KEY,
 data jsonb NOT NULL CHECK (octet_length(data::text) <= 12000),
 blob_key text NOT NULL REFERENCES tutor_blobs(key),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE TABLE tutor_operations (
 key text PRIMARY KEY CHECK (length(key) <= 200),
 owner uuid NOT NULL,
 state text NOT NULL CHECK (state IN ('active','failed','done')),
 expires_at timestamptz NOT NULL,
 result jsonb CHECK (octet_length(result::text) <= 12000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tutor_active_operations ON tutor_operations(expires_at) WHERE state = 'active';
CREATE TABLE tutor_usage (
 day date NOT NULL DEFAULT CURRENT_DATE,
 subject text NOT NULL,
 kind text NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
 PRIMARY KEY (day, subject, kind)
);
CREATE TABLE tutor_access (
 session_id text NOT NULL,
 lesson_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (session_id, lesson_id)
);
