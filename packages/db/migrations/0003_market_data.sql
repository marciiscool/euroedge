-- Normalized market-data ticks (brief §4). Market data is a float input to fv-core; never money.
CREATE TABLE ticks (
  ts        timestamptz      NOT NULL,
  source    text             NOT NULL,
  venue     text             NOT NULL,
  symbol    text             NOT NULL,
  kind      text             NOT NULL,
  currency  text             NOT NULL,
  bid       double precision,
  ask       double precision,
  last      double precision,
  size      double precision
);
SELECT create_hypertable('ticks', by_range('ts', INTERVAL '1 day'));
CREATE INDEX ticks_instrument_ts ON ticks (venue, symbol, ts DESC);
ALTER TABLE ticks SET (timescaledb.compress, timescaledb.compress_segmentby = 'venue, symbol');
SELECT add_compression_policy('ticks', INTERVAL '7 days');

-- FV series per market (brief §6), 1 s resolution, decimal strings kept as numeric for display.
CREATE TABLE fv_series (
  ts          timestamptz NOT NULL,
  market      text        NOT NULL,
  win         char(1)     NOT NULL,
  fv          numeric     NOT NULL,
  band_lo     numeric     NOT NULL,
  band_hi     numeric     NOT NULL,
  idx         numeric     NOT NULL,
  mark        numeric     NOT NULL,
  sigma_bp    double precision NOT NULL,
  confidence  text        NOT NULL
);
SELECT create_hypertable('fv_series', by_range('ts', INTERVAL '1 day'));
CREATE INDEX fv_series_market_ts ON fv_series (market, ts DESC);
ALTER TABLE fv_series SET (timescaledb.compress, timescaledb.compress_segmentby = 'market');
SELECT add_compression_policy('fv_series', INTERVAL '7 days');
