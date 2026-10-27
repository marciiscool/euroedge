-- Engine event log (ADR-0001): inputs only, canonical bytes, hash-chained, append-only.
CREATE TABLE engine_events (
  seq          bigint      PRIMARY KEY,
  ts_ms        bigint      NOT NULL,
  type         text        NOT NULL,
  v            smallint    NOT NULL,
  body         bytea       NOT NULL,  -- canonical JSON of {seq, ts, v, input}; never jsonb (key order)
  hash         bytea       NOT NULL,  -- sha256(prev_hash || body)
  request_id   text,
  appended_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engine_events_request_id ON engine_events (request_id) WHERE request_id IS NOT NULL;

CREATE FUNCTION engine_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engine_events is append-only';
END;
$$;
CREATE TRIGGER engine_events_no_update_delete
  BEFORE UPDATE OR DELETE ON engine_events
  FOR EACH ROW EXECUTE FUNCTION engine_events_append_only();
CREATE TRIGGER engine_events_no_truncate
  BEFORE TRUNCATE ON engine_events
  FOR EACH STATEMENT EXECUTE FUNCTION engine_events_append_only();

-- Last consumed input-stream id, committed atomically with the events it produced.
CREATE TABLE engine_cursor (
  id        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stream_id text     NOT NULL
);
