CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  strain TEXT,
  image_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pack_size INT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT,
  qr_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_balance (
  variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  on_hand INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (variant_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  variant_id INT NOT NULL REFERENCES product_variants(id),
  warehouse_id INT NOT NULL REFERENCES warehouses(id),
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','reserve','release')),
  qty INT NOT NULL CHECK (qty > 0),
  note TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT UNIQUE,
  source TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  warehouse_id INT REFERENCES warehouses(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_lines (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INT NOT NULL REFERENCES product_variants(id),
  qty_ordered INT NOT NULL CHECK (qty_ordered > 0),
  qty_reserved INT NOT NULL DEFAULT 0,
  qty_picked INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  variant_id INT NOT NULL REFERENCES product_variants(id),
  from_warehouse_id INT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INT NOT NULL REFERENCES warehouses(id),
  qty INT NOT NULL CHECK (qty > 0),
  note TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_prestashop_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT,
  default_warehouse_id INT REFERENCES warehouses(id),
  order_state_filter TEXT,
  pull_limit INT NOT NULL DEFAULT 25 CHECK (pull_limit > 0 AND pull_limit <= 200),
  timeout_ms INT NOT NULL DEFAULT 12000 CHECK (timeout_ms >= 1000 AND timeout_ms <= 60000),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
