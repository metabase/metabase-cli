-- ============================================================================
-- Diverse Postgres seed for metabase-cli e2e
--
-- Purpose: exercise as many type & relationship shapes as Metabase cares about
-- (sync, query, viz) while keeping the dataset small and deterministic.
--
-- Schemas:   public.*  (transactional)
--            analytics.*  (rollups / non-public schema sync coverage)
--
-- Determinism: explicit row PKs and fixed timestamps so future snapshot-based
-- assertions are stable across boots.
-- ============================================================================

CREATE SCHEMA analytics;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'refunded');
CREATE TYPE product_category AS ENUM ('gadgets', 'apparel', 'office', 'home');

-- ----------------------------------------------------------------------------
-- public.customers
-- Mixed-type dimension table: text, date, timestamptz, boolean, numeric,
-- jsonb, text[], uuid, inet, bytea.
-- ----------------------------------------------------------------------------

CREATE TABLE customers (
  id                  INTEGER       PRIMARY KEY,
  email               VARCHAR(254)  NOT NULL UNIQUE,
  full_name           TEXT          NOT NULL,
  signup_date         DATE          NOT NULL,
  signup_at           TIMESTAMPTZ   NOT NULL,
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  lifetime_value_cents BIGINT       NOT NULL DEFAULT 0,
  attributes          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  tags                TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  external_uuid       UUID          NOT NULL UNIQUE,
  last_ip             INET          NULL,
  avatar              BYTEA         NULL
);

COMMENT ON TABLE customers IS 'Customer dimension; mixed types for sync coverage.';
COMMENT ON COLUMN customers.lifetime_value_cents IS 'Cumulative spend in cents (BIGINT for headroom).';

INSERT INTO customers (id, email, full_name, signup_date, signup_at, is_active, lifetime_value_cents, attributes, tags, external_uuid, last_ip, avatar) VALUES
  (1, 'ada@example.test',     'Ada Lovelace',      '2024-11-01', '2024-11-01T09:00:00Z', true,  189800,
     '{"plan":"pro","newsletter":true,"referrer":null}'::jsonb,
     ARRAY['vip','beta'],     '11111111-1111-1111-1111-111111111111', '10.0.0.1',
     decode('cafebabe', 'hex')),
  (2, 'grace@example.test',   'Grace Hopper',      '2024-11-15', '2024-11-15T14:30:00Z', true,  239900,
     '{"plan":"team","newsletter":false}'::jsonb,
     ARRAY['vip'],             '22222222-2222-2222-2222-222222222222', '10.0.0.2',
     NULL),
  (3, 'alan@example.test',    'Alan Turing',       '2024-12-03', '2024-12-03T08:15:00Z', true,   45900,
     '{"plan":"free"}'::jsonb,
     ARRAY['trial'],           '33333333-3333-3333-3333-333333333333', '192.168.1.5',
     NULL),
  (4, 'donald@example.test',  'Donald Knuth',      '2024-12-20', '2024-12-20T11:00:00Z', false,  10000,
     '{"plan":"free","churned":true}'::jsonb,
     ARRAY[]::TEXT[],          '44444444-4444-4444-4444-444444444444', NULL,
     NULL),
  (5, 'edsger@example.test',  'Edsger Dijkstra',   '2025-01-04', '2025-01-04T16:45:00Z', true,  319800,
     '{"plan":"team","newsletter":true,"company":"acme"}'::jsonb,
     ARRAY['vip','beta','partner'], '55555555-5555-5555-5555-555555555555', '203.0.113.7',
     decode('deadbeef', 'hex')),
  (6, 'margaret@example.test','Margaret Hamilton', '2025-02-10', '2025-02-10T07:30:00Z', true,   12500,
     '{"plan":"free"}'::jsonb,
     ARRAY['trial'],           '66666666-6666-6666-6666-666666666666', NULL,
     NULL);

-- ----------------------------------------------------------------------------
-- public.products
-- Numeric + enum + jsonb. weight_kg is REAL to also exercise floating-point.
-- ----------------------------------------------------------------------------

CREATE TABLE products (
  id           INTEGER          PRIMARY KEY,
  name         TEXT             NOT NULL,
  sku          CHAR(10)         NOT NULL UNIQUE,
  category     product_category NOT NULL,
  price_cents  INTEGER          NOT NULL,
  weight_kg    REAL             NULL,
  in_stock     BOOLEAN          NOT NULL DEFAULT true,
  attributes   JSONB            NOT NULL DEFAULT '{}'::jsonb,
  released_on  DATE             NOT NULL,
  created_at   TIMESTAMPTZ      NOT NULL
);

INSERT INTO products (id, name, sku, category, price_cents, weight_kg, in_stock, attributes, released_on, created_at) VALUES
  ( 1, 'Widget',    'GAD-WID-01', 'gadgets',  1099, 0.250,  true,
       '{"color":"blue","battery":"AA"}'::jsonb,        '2024-06-01', '2024-06-01T00:00:00Z'),
  ( 2, 'Sprocket',  'GAD-SPR-01', 'gadgets',   799, 0.180,  true,
       '{"color":"silver"}'::jsonb,                       '2024-06-15', '2024-06-15T00:00:00Z'),
  ( 3, 'Cog',       'GAD-COG-01', 'gadgets',   499, 0.090,  false,
       '{}'::jsonb,                                       '2024-07-01', '2024-07-01T00:00:00Z'),
  ( 4, 'Hat',       'APP-HAT-01', 'apparel',  1599, 0.120,  true,
       '{"sizes":["S","M","L"],"material":"wool"}'::jsonb,'2024-09-01', '2024-09-01T00:00:00Z'),
  ( 5, 'Shirt',     'APP-SHI-01', 'apparel',  2599, 0.300,  true,
       '{"sizes":["S","M","L","XL"]}'::jsonb,             '2024-09-10', '2024-09-10T00:00:00Z'),
  ( 6, 'Boots',     'APP-BOO-01', 'apparel',  4999, 1.200,  true,
       '{"sizes":["8","9","10","11"]}'::jsonb,            '2024-10-01', '2024-10-01T00:00:00Z'),
  ( 7, 'Notebook',  'OFF-NOT-01', 'office',    599, 0.350,  true,
       '{"pages":120,"paper":"recycled"}'::jsonb,         '2024-08-01', '2024-08-01T00:00:00Z'),
  ( 8, 'Pen',       'OFF-PEN-01', 'office',    199, 0.020,  true,
       '{}'::jsonb,                                       '2024-08-05', '2024-08-05T00:00:00Z'),
  ( 9, 'Stapler',   'OFF-STA-01', 'office',   1299, 0.450,  true,
       '{"capacity":50}'::jsonb,                          '2024-08-10', '2024-08-10T00:00:00Z'),
  (10, 'Lamp',      'HOM-LAM-01', 'home',     2299, 1.800,  true,
       '{"watts":40}'::jsonb,                             '2024-11-01', '2024-11-01T00:00:00Z'),
  (11, 'Mug',       'HOM-MUG-01', 'home',      699, 0.380,  true,
       '{"capacity_ml":350}'::jsonb,                      '2024-11-05', '2024-11-05T00:00:00Z'),
  (12, 'Pillow',    'HOM-PIL-01', 'home',     1899, 0.600,  false,
       '{"filling":"down"}'::jsonb,                       '2024-12-01', '2024-12-01T00:00:00Z');

-- ----------------------------------------------------------------------------
-- public.orders + order_items
-- FK chain (orders -> customers, order_items -> orders + products) for
-- Metabase's relationship detection.
-- ----------------------------------------------------------------------------

CREATE TABLE orders (
  id            INTEGER       PRIMARY KEY,
  customer_id   INTEGER       NOT NULL REFERENCES customers (id),
  status        order_status  NOT NULL,
  subtotal_cents BIGINT       NOT NULL,
  tax_cents     BIGINT        NOT NULL DEFAULT 0,
  total_cents   BIGINT        NOT NULL,
  notes         TEXT          NULL,
  created_at    TIMESTAMPTZ   NOT NULL,
  fulfilled_at  TIMESTAMPTZ   NULL
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);
CREATE INDEX orders_created_at_idx  ON orders (created_at);

INSERT INTO orders (id, customer_id, status, subtotal_cents, tax_cents, total_cents, notes, created_at, fulfilled_at) VALUES
  ( 1, 1, 'delivered',  1099,  88,  1187, NULL,             '2025-01-01T10:00:00Z', '2025-01-03T14:00:00Z'),
  ( 2, 1, 'delivered',  1599, 128,  1727, 'gift wrap',      '2025-01-02T10:00:00Z', '2025-01-05T11:00:00Z'),
  ( 3, 2, 'shipped',     799,  64,   863, NULL,             '2025-01-03T10:00:00Z', '2025-01-04T09:00:00Z'),
  ( 4, 2, 'paid',       2599, 208,  2807, NULL,             '2025-01-04T10:00:00Z', NULL),
  ( 5, 3, 'pending',     499,  40,   539, NULL,             '2025-01-05T10:00:00Z', NULL),
  ( 6, 3, 'refunded',   4999, 400,  5399, 'damaged in transit', '2025-01-06T10:00:00Z', '2025-01-08T12:00:00Z'),
  ( 7, 4, 'delivered',   599,  48,   647, NULL,             '2025-01-07T10:00:00Z', '2025-01-09T16:00:00Z'),
  ( 8, 4, 'delivered',   199,  16,   215, NULL,             '2025-01-08T10:00:00Z', '2025-01-10T16:00:00Z'),
  ( 9, 5, 'delivered',  1299, 104,  1403, NULL,             '2025-01-09T10:00:00Z', '2025-01-11T13:00:00Z'),
  (10, 5, 'shipped',    2299, 184,  2483, NULL,             '2025-01-10T10:00:00Z', '2025-01-12T14:00:00Z'),
  (11, 6, 'paid',        699,  56,   755, 'no rush',        '2025-01-11T10:00:00Z', NULL),
  (12, 6, 'pending',    1899, 152,  2051, NULL,             '2025-01-12T10:00:00Z', NULL);

CREATE TABLE order_items (
  order_id        INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products (id),
  quantity        SMALLINT NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  line_total_cents BIGINT  NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents) VALUES
  ( 1,  1, 1, 1099,  1099),
  ( 2,  4, 1, 1599,  1599),
  ( 3,  2, 1,  799,   799),
  ( 4,  5, 1, 2599,  2599),
  ( 5,  3, 1,  499,   499),
  ( 6,  6, 1, 4999,  4999),
  ( 7,  7, 1,  599,   599),
  ( 8,  8, 1,  199,   199),
  ( 9,  9, 1, 1299,  1299),
  (10, 10, 1, 2299,  2299),
  (11, 11, 1,  699,   699),
  (12, 12, 1, 1899,  1899);

-- ----------------------------------------------------------------------------
-- public.reviews
-- Nullable text body + numeric rating; useful for null-handling and grouping.
-- ----------------------------------------------------------------------------

CREATE TABLE reviews (
  id          INTEGER     PRIMARY KEY,
  customer_id INTEGER     NOT NULL REFERENCES customers (id),
  product_id  INTEGER     NOT NULL REFERENCES products  (id),
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT        NULL,
  helpful_pct NUMERIC(5,2) NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

INSERT INTO reviews (id, customer_id, product_id, rating, body, helpful_pct, created_at) VALUES
  (1, 1,  1, 5, 'Solid widget.',                 92.50, '2025-01-04T10:00:00Z'),
  (2, 1,  4, 4, NULL,                            71.00, '2025-01-06T10:00:00Z'),
  (3, 2,  5, 5, 'Fits great, washes well.',      88.30, '2025-01-05T10:00:00Z'),
  (4, 3,  3, 2, 'Smaller than expected.',        45.20, '2025-01-06T10:00:00Z'),
  (5, 4,  7, 4, 'Good for the price.',            NULL, '2025-01-09T10:00:00Z'),
  (6, 5,  9, 5, 'Heavy-duty.',                   95.10, '2025-01-12T10:00:00Z'),
  (7, 5, 10, 3, NULL,                             NULL, '2025-01-13T10:00:00Z');

-- ----------------------------------------------------------------------------
-- public.order_summary view
-- Computed columns (sum/count) — Metabase will sync this as a queryable view.
-- ----------------------------------------------------------------------------

CREATE VIEW order_summary AS
SELECT
  o.id           AS order_id,
  o.customer_id,
  c.full_name    AS customer_name,
  o.status,
  o.total_cents,
  COUNT(oi.product_id)  AS line_count,
  SUM(oi.quantity)      AS total_quantity,
  o.created_at,
  o.fulfilled_at
FROM orders o
JOIN customers c   ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.full_name;

-- ----------------------------------------------------------------------------
-- analytics.daily_sales (non-public schema)
-- DATE rollup; exercises Metabase's multi-schema sync.
-- ----------------------------------------------------------------------------

CREATE TABLE analytics.daily_sales (
  day            DATE        PRIMARY KEY,
  gross_cents    BIGINT      NOT NULL,
  refund_cents   BIGINT      NOT NULL DEFAULT 0,
  order_count    INTEGER     NOT NULL,
  unique_customers INTEGER   NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT '2025-01-13T00:00:00Z'
);

INSERT INTO analytics.daily_sales (day, gross_cents, refund_cents, order_count, unique_customers, computed_at) VALUES
  ('2025-01-01', 1187, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-02', 1727, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-03',  863, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-04', 2807, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-05',  539, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-06', 5399, 5399, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-07',  647, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-08',  215, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-09', 1403, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-10', 2483, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-11',  755, 0, 1, 1, '2025-01-13T00:00:00Z'),
  ('2025-01-12', 2051, 0, 1, 1, '2025-01-13T00:00:00Z');

-- ----------------------------------------------------------------------------
-- Permissions: ensure metabase_test (the DB user from docker-compose.yml)
-- can read everything across schemas, including future tables.
-- ----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA analytics TO metabase_test;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO metabase_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO metabase_test;
