-- Read models (M4-22): projections of engine outputs for REST history (M6-06).
-- Derived data only: rebuilt from the event log by replay, never a source of truth.
-- Rows are keyed by (seq, n) — event seq and output index — so re-projection is idempotent.
CREATE TABLE rm_fills (
  seq         bigint   NOT NULL,
  n           integer  NOT NULL,
  ts_ms       bigint   NOT NULL,
  account     text     NOT NULL,
  market      text     NOT NULL,
  side        text     NOT NULL,
  qty_lots    bigint   NOT NULL,
  price_ticks bigint   NOT NULL,
  fee         bigint   NOT NULL,  -- µUSDC
  realized    bigint   NOT NULL,  -- µUSDC
  request_id  text     NOT NULL,
  PRIMARY KEY (seq, n)
);
CREATE INDEX rm_fills_account ON rm_fills (account, seq DESC);

CREATE TABLE rm_orders (
  seq         bigint   NOT NULL,
  n           integer  NOT NULL,
  ts_ms       bigint   NOT NULL,
  account     text     NOT NULL,
  request_id  text     NOT NULL,
  order_id    text,
  status      text     NOT NULL,  -- accepted | cancelled | rejected
  reason      text,
  PRIMARY KEY (seq, n)
);
CREATE INDEX rm_orders_account ON rm_orders (account, seq DESC);

CREATE TABLE rm_liquidations (
  seq             bigint  NOT NULL,
  n               integer NOT NULL,
  ts_ms           bigint  NOT NULL,
  account         text    NOT NULL,
  markets         text[]  NOT NULL,
  penalty         bigint  NOT NULL,
  insurance_cover bigint  NOT NULL,
  partial         boolean NOT NULL,
  PRIMARY KEY (seq, n)
);
CREATE INDEX rm_liquidations_account ON rm_liquidations (account, seq DESC);

-- Funding, dividends and withdrawals per account; amount > 0 = credited to the user.
CREATE TABLE rm_cash_flows (
  seq      bigint  NOT NULL,
  n        integer NOT NULL,
  ts_ms    bigint  NOT NULL,
  account  text    NOT NULL,
  kind     text    NOT NULL,
  market   text,
  ref      text,
  amount   bigint  NOT NULL,
  PRIMARY KEY (seq, n)
);
CREATE INDEX rm_cash_flows_account ON rm_cash_flows (account, seq DESC);

CREATE TABLE rm_cursor (
  id   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seq  bigint   NOT NULL
);
