-- Vault indexer cursor (M5-09): last block fully forwarded to the engine, per chain.
CREATE TABLE indexer_cursor (
  chain_id  integer PRIMARY KEY,
  block     bigint  NOT NULL
);
