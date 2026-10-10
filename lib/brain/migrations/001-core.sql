-- 001-core.sql — the brain schema. Rules live here, enforced on write.
-- Timestamps are ISO-8601 UTC strings. Booleans are 0/1 with a CHECK.

CREATE TABLE features (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE
                CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'
                       AND slug NOT GLOB '*--*' AND slug NOT GLOB '*-'),
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'in-progress', 'shipped', 'blocked', 'cut')),
  description   TEXT,
  pr_url        TEXT CHECK (pr_url IS NULL OR pr_url GLOB 'http*://*'),
  evidence      TEXT,
  -- imported as shipped with no verification row; replaces policy.strict_grandfathered
  grandfathered INTEGER NOT NULL DEFAULT 0 CHECK (grandfathered IN (0, 1)),
  created       TEXT NOT NULL,
  updated       TEXT NOT NULL,
  CHECK (status <> 'shipped' OR length(trim(coalesce(evidence, ''))) > 0),
  CHECK (grandfathered = 0 OR status = 'shipped')
);
-- policy one_in_progress_at_a_time, enforced by the index itself
CREATE UNIQUE INDEX features_one_in_progress ON features (status) WHERE status = 'in-progress';

CREATE TABLE feature_deps (
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, depends_on),
  CHECK (feature_id <> depends_on)
);

CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY,
  feature_id  INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (key GLOB 't[0-9]*' AND substr(key, 2) NOT GLOB '*[^0-9]*'),
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'claimed', 'done', 'blocked', 'cut')),
  acceptance  TEXT NOT NULL CHECK (length(trim(acceptance)) > 0),
  verify      TEXT,
  files       TEXT CHECK (files IS NULL OR (json_valid(files) AND json_type(files) = 'array')),
  claimed_by  TEXT,
  claim_token TEXT,
  claimed_at  TEXT,
  evidence    TEXT,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,
  UNIQUE (feature_id, key),
  CHECK (status <> 'claimed' OR (claimed_by IS NOT NULL AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (status = 'claimed' OR (claimed_by IS NULL AND claim_token IS NULL AND claimed_at IS NULL)),
  CHECK (status <> 'done' OR length(trim(coalesce(evidence, ''))) > 0)
);

CREATE TABLE task_deps (
  task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);
CREATE TRIGGER task_deps_same_feature BEFORE INSERT ON task_deps
WHEN (SELECT feature_id FROM tasks WHERE id = NEW.task_id)
  <> (SELECT feature_id FROM tasks WHERE id = NEW.depends_on)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: task dependency crosses features');
END;

CREATE TABLE checkpoints (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  branch     TEXT,
  -- writers clip with a trailing … or throw SUMMARY_TOO_LONG; never a silent cut (#5)
  summary    TEXT NOT NULL CHECK (length(trim(summary)) > 0 AND length(summary) <= 200),
  next       TEXT,
  body       TEXT,
  feature_id INTEGER REFERENCES features (id) ON DELETE SET NULL,
  -- the run note this checkpoint links to (#9)
  run        TEXT CHECK (run IS NULL OR (run GLOB '[A-Za-z0-9]*' AND run NOT GLOB '*[^A-Za-z0-9._-]*'))
);

CREATE TABLE run_steps (
  id         INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  run        TEXT NOT NULL CHECK (run GLOB '[A-Za-z0-9]*' AND run NOT GLOB '*[^A-Za-z0-9._-]*'),
  n          INTEGER NOT NULL CHECK (n >= 1),
  step       TEXT NOT NULL CHECK (length(trim(step)) > 0),
  observed   TEXT NOT NULL CHECK (length(trim(observed)) > 0),
  task_id    INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  author     TEXT,
  at         TEXT NOT NULL,
  UNIQUE (feature_id, run, n)
);

CREATE TABLE docs (
  id      INTEGER PRIMARY KEY,
  section TEXT NOT NULL
          CHECK (section IN ('rules', 'recipes', 'codebase', 'architecture', 'features', 'emails', 'transcripts')),
  name    TEXT NOT NULL CHECK (name GLOB '[A-Za-z0-9]*' AND name NOT GLOB '*[^A-Za-z0-9._-]*'),
  title   TEXT,
  body    TEXT NOT NULL CHECK (length(trim(body)) > 0),
  updated TEXT NOT NULL,
  UNIQUE (section, name)
);

-- Plan HTML stays a file (the browser loads it by URL); the row keeps path + hash.
CREATE TABLE plans (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[A-Za-z0-9]*' AND slug NOT GLOB '*[^A-Za-z0-9._-]*'),
  title           TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  sha256          TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  feature_id      INTEGER REFERENCES features (id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'in-review', 'reviewed', 'approved')),
  rounds          INTEGER NOT NULL DEFAULT 0 CHECK (rounds >= 0),
  approved_by     TEXT,
  session_open    INTEGER NOT NULL DEFAULT 0 CHECK (session_open IN (0, 1)),
  session_port    INTEGER,
  session_started TEXT,
  created         TEXT NOT NULL,
  updated         TEXT NOT NULL,
  CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);

CREATE TABLE review_rounds (
  id              INTEGER PRIMARY KEY,
  plan_id         INTEGER NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  round           INTEGER NOT NULL CHECK (round >= 1),
  at              TEXT NOT NULL,
  ended_by        TEXT,
  snapshot_path   TEXT,
  snapshot_sha256 TEXT CHECK (snapshot_sha256 IS NULL OR length(snapshot_sha256) = 64),
  UNIQUE (plan_id, round)
);

CREATE TABLE review_prompts (
  id       INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES review_rounds (id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL CHECK (seq >= 1),
  tag      TEXT,
  prompt   TEXT NOT NULL,
  selector TEXT,
  text     TEXT,
  html     TEXT,
  target   TEXT CHECK (target IS NULL OR json_valid(target)),
  UNIQUE (round_id, seq)
);

CREATE TABLE verifications (
  id             INTEGER PRIMARY KEY,
  feature_id     INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  verdict        TEXT NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'BLOCKED')),
  round          INTEGER NOT NULL CHECK (round >= 1),
  body           TEXT NOT NULL CHECK (length(trim(body)) > 0),
  commit_sha     TEXT CHECK (commit_sha IS NULL OR (length(commit_sha) BETWEEN 7 AND 40
                                                    AND commit_sha NOT GLOB '*[^0-9a-f]*')),
  verified_by    TEXT NOT NULL CHECK (length(trim(verified_by)) > 0),
  implemented_by TEXT,
  -- the tree had uncommitted changes when the verdict was recorded (#11)
  dirty          INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
  at             TEXT NOT NULL,
  UNIQUE (feature_id, round)
);

CREATE TABLE shots (
  id              INTEGER PRIMARY KEY,
  verification_id INTEGER NOT NULL REFERENCES verifications (id) ON DELETE CASCADE,
  path            TEXT NOT NULL,
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  caption         TEXT,
  UNIQUE (verification_id, path)
);

-- stages: comma list drawn from bootstrap|baseline|verify (no subqueries in CHECK,
-- so strip every legal ",stage" and require nothing left)
CREATE TABLE verify_checks (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9]*' AND name NOT GLOB '*[^A-Za-z0-9._-]*'),
  run     TEXT NOT NULL CHECK (length(trim(run)) > 0),
  stages  TEXT NOT NULL CHECK (length(stages) > 0 AND
            replace(replace(replace(',' || stages, ',bootstrap', ''), ',baseline', ''), ',verify', '') = ''),
  timeout INTEGER NOT NULL DEFAULT 300 CHECK (timeout > 0)
);

CREATE TABLE gate_runs (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  stage      TEXT CHECK (stage IS NULL OR stage IN ('bootstrap', 'baseline', 'verify')),
  check_name TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'timeout')),
  exit       INTEGER,
  seconds    REAL NOT NULL CHECK (seconds >= 0),
  tail       TEXT,
  branch     TEXT,
  commit_sha TEXT,
  feature_id INTEGER REFERENCES features (id) ON DELETE SET NULL
);

-- Full-text search across features, docs, checkpoints, run steps, verifications.
-- rowid = source id * 8 + kind code (1 feature, 2 doc, 3 checkpoint, 4 run step,
-- 5 verification), so triggers can update and delete in O(1).
CREATE VIRTUAL TABLE search USING fts5 (kind UNINDEXED, ref UNINDEXED, title, body, tokenize = 'porter unicode61');

CREATE TRIGGER features_ai AFTER INSERT ON features BEGIN
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 1, 'feature', NEW.slug, NEW.name,
          coalesce(NEW.description, '') || char(10) || coalesce(NEW.evidence, ''));
END;
CREATE TRIGGER features_au AFTER UPDATE ON features BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 1;
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 1, 'feature', NEW.slug, NEW.name,
          coalesce(NEW.description, '') || char(10) || coalesce(NEW.evidence, ''));
END;
CREATE TRIGGER features_ad AFTER DELETE ON features BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 1;
END;

CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 2, 'doc', NEW.section || '/' || NEW.name, coalesce(NEW.title, NEW.name), NEW.body);
END;
CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 2;
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 2, 'doc', NEW.section || '/' || NEW.name, coalesce(NEW.title, NEW.name), NEW.body);
END;
CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 2;
END;

CREATE TRIGGER checkpoints_ai AFTER INSERT ON checkpoints BEGIN
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 3, 'checkpoint', 'checkpoint:' || NEW.id, NEW.summary,
          coalesce(NEW.next, '') || char(10) || coalesce(NEW.body, ''));
END;
CREATE TRIGGER checkpoints_au AFTER UPDATE ON checkpoints BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 3;
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 3, 'checkpoint', 'checkpoint:' || NEW.id, NEW.summary,
          coalesce(NEW.next, '') || char(10) || coalesce(NEW.body, ''));
END;
CREATE TRIGGER checkpoints_ad AFTER DELETE ON checkpoints BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 3;
END;

CREATE TRIGGER run_steps_ai AFTER INSERT ON run_steps BEGIN
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 4, 'run-step',
          (SELECT slug FROM features WHERE id = NEW.feature_id) || '/' || NEW.run || '#' || NEW.n,
          NEW.step, NEW.observed);
END;
CREATE TRIGGER run_steps_au AFTER UPDATE ON run_steps BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 4;
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 4, 'run-step',
          (SELECT slug FROM features WHERE id = NEW.feature_id) || '/' || NEW.run || '#' || NEW.n,
          NEW.step, NEW.observed);
END;
CREATE TRIGGER run_steps_ad AFTER DELETE ON run_steps BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 4;
END;

CREATE TRIGGER verifications_ai AFTER INSERT ON verifications BEGIN
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 5, 'verification',
          (SELECT slug FROM features WHERE id = NEW.feature_id) || ' r' || NEW.round,
          NEW.verdict, NEW.body);
END;
CREATE TRIGGER verifications_au AFTER UPDATE ON verifications BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 5;
  INSERT INTO search (rowid, kind, ref, title, body)
  VALUES (NEW.id * 8 + 5, 'verification',
          (SELECT slug FROM features WHERE id = NEW.feature_id) || ' r' || NEW.round,
          NEW.verdict, NEW.body);
END;
CREATE TRIGGER verifications_ad AFTER DELETE ON verifications BEGIN
  DELETE FROM search WHERE rowid = OLD.id * 8 + 5;
END;
