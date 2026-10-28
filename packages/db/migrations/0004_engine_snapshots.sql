-- Engine state snapshots (M4-19). A startup cache only: the event log stays the source of truth,
-- and every snapshot is checked against the hash chain and its own digest before use.
CREATE TABLE engine_snapshots (
  seq         bigint      PRIMARY KEY REFERENCES engine_events (seq),
  chain_hash  bytea       NOT NULL,  -- log hash of event `seq`
  digest      text        NOT NULL,  -- stateDigest(state) after event `seq`
  body        bytea       NOT NULL,  -- encodeState(state), canonical bytes
  created_at  timestamptz NOT NULL DEFAULT now()
);
