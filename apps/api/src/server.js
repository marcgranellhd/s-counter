const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('redis');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const port = process.env.PORT || 3001;
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const ALLOWED_PACK_SIZES = [3, 5, 10, 15, 100, 250];
const PRESTASHOP_DEFAULTS = {
  base_url: '',
  api_key: null,
  default_warehouse_id: null,
  order_state_filter: null,
  pull_limit: 25,
  timeout_ms: 12000
};
const DEFAULT_PRODUCT_IMAGE_URL =
  'https://images.unsplash.com/photo-1603909223429-69bb7101f420?auto=format&fit=crop&w=800&q=60';
const PRESTASHOP_AUTO_SYNC_MIN_INTERVAL_MS = 15000;
let prestashopAutoSyncInFlight = null;
let prestashopAutoSyncLastRunMs = 0;

const pool = new Pool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
redis.on('error', (err) => console.error('Redis error:', err.message));
redis.connect().catch((err) => console.error('Redis connect failed:', err.message));
ensureProductImageStorage().catch((err) =>
  console.error('Product image migration failed on boot:', err.message)
);

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const prestashopSettingsTableSql = `
  CREATE TABLE IF NOT EXISTS integration_prestashop_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT,
    default_warehouse_id INT REFERENCES warehouses(id),
    order_state_filter TEXT,
    pull_limit INT NOT NULL DEFAULT 25 CHECK (pull_limit > 0 AND pull_limit <= 200),
    timeout_ms INT NOT NULL DEFAULT 12000 CHECK (timeout_ms >= 1000 AND timeout_ms <= 60000),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`;

async function ensureBalanceRow(client, variantId, warehouseId) {
  await client.query(
    `INSERT INTO stock_balance (variant_id, warehouse_id, on_hand, reserved)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (variant_id, warehouse_id) DO NOTHING`,
    [variantId, warehouseId]
  );
}

async function ensureProductImageStorage(client = pool) {
  await client.query('ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image_url TEXT');
  await client.query(
    `UPDATE products
     SET image_url = $1
     WHERE image_url IS NULL OR TRIM(image_url) = ''`,
    [DEFAULT_PRODUCT_IMAGE_URL]
  );
}

function normalizeProductImageReference(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new Error('La foto del producto es obligatoria');
  }

  const isDataImage = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value);
  if (isDataImage) return value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('La foto debe ser URL valida (http/https) o base64');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('La foto debe usar http://, https:// o base64');
  }

  return value;
}

async function applyMovement(client, { variantId, warehouseId, type, qty, note, actor }) {
  await ensureBalanceRow(client, variantId, warehouseId);

  const current = await client.query(
    'SELECT on_hand, reserved FROM stock_balance WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE',
    [variantId, warehouseId]
  );

  if (current.rowCount === 0) throw new Error('No se pudo bloquear balance de stock');

  let { on_hand: onHand, reserved } = current.rows[0];

  if (type === 'in' || type === 'adjust') onHand += qty;
  if (type === 'out') onHand -= qty;
  if (type === 'reserve') reserved += qty;
  if (type === 'release') reserved -= qty;

  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    throw new Error('Movimiento inválido: stock/reserva inconsistente');
  }

  await client.query(
    'UPDATE stock_balance SET on_hand = $1, reserved = $2, updated_at = NOW() WHERE variant_id = $3 AND warehouse_id = $4',
    [onHand, reserved, variantId, warehouseId]
  );

  await client.query(
    'INSERT INTO inventory_movements (variant_id, warehouse_id, type, qty, note, actor) VALUES ($1,$2,$3,$4,$5,$6)',
    [variantId, warehouseId, type, qty, note || null, actor || 'system']
  );

  return { on_hand: onHand, reserved, available: onHand - reserved };
}

function parseIntStrict(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${field} debe ser entero`);
  return parsed;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePrestashopBaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  const normalized = value.replace(/\/+$/, '');

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('baseUrl de PrestaShop invalida');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl debe empezar por http:// o https://');
  }

  return normalized;
}

function normalizeOrderStateFilter(rawFilter) {
  const value = String(rawFilter || '').trim();
  if (!value) return null;

  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parsed = Number(item);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('orderStateFilter debe ser una lista de ids enteros (ej: 2,3,4)');
      }
      return String(parsed);
    });

  return parts.length ? parts.join(',') : null;
}

function normalizePrestashopPayload(payload, current) {
  const next = {
    base_url: current.base_url || PRESTASHOP_DEFAULTS.base_url,
    api_key: current.api_key || PRESTASHOP_DEFAULTS.api_key,
    default_warehouse_id: current.default_warehouse_id || PRESTASHOP_DEFAULTS.default_warehouse_id,
    order_state_filter: current.order_state_filter || PRESTASHOP_DEFAULTS.order_state_filter,
    pull_limit: Number(current.pull_limit || PRESTASHOP_DEFAULTS.pull_limit),
    timeout_ms: Number(current.timeout_ms || PRESTASHOP_DEFAULTS.timeout_ms)
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'baseUrl')) {
    next.base_url = normalizePrestashopBaseUrl(payload.baseUrl);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'orderStateFilter')) {
    next.order_state_filter = normalizeOrderStateFilter(payload.orderStateFilter);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'pullLimit')) {
    const pullLimit = parseIntStrict(payload.pullLimit, 'pullLimit');
    if (pullLimit < 1 || pullLimit > 200) {
      throw new Error('pullLimit debe estar entre 1 y 200');
    }
    next.pull_limit = pullLimit;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'defaultWarehouseId')) {
    const warehouseId = payload.defaultWarehouseId;
    if (warehouseId === null || warehouseId === '' || Number(warehouseId) === 0) {
      next.default_warehouse_id = null;
    } else {
      next.default_warehouse_id = parseIntStrict(warehouseId, 'defaultWarehouseId');
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'timeoutMs')) {
    const timeoutMs = parseIntStrict(payload.timeoutMs, 'timeoutMs');
    if (timeoutMs < 1000 || timeoutMs > 60000) {
      throw new Error('timeoutMs debe estar entre 1000 y 60000');
    }
    next.timeout_ms = timeoutMs;
  }

  if (payload.clearApiKey === true) {
    next.api_key = null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'apiKey')) {
    const key = String(payload.apiKey || '').trim();
    if (key) {
      next.api_key = key;
    }
  }

  return next;
}

function toPublicPrestashopSettings(row) {
  const key = row.api_key ? String(row.api_key) : '';
  const masked =
    key.length === 0
      ? null
      : `${key.slice(0, Math.min(4, key.length))}***${key.slice(Math.max(0, key.length - 2))}`;

  return {
    baseUrl: row.base_url || '',
    defaultWarehouseId: row.default_warehouse_id ? Number(row.default_warehouse_id) : null,
    orderStateFilter: row.order_state_filter || '',
    pullLimit: Number(row.pull_limit || PRESTASHOP_DEFAULTS.pull_limit),
    timeoutMs: Number(row.timeout_ms || PRESTASHOP_DEFAULTS.timeout_ms),
    hasApiKey: Boolean(key),
    apiKeyMasked: masked,
    updatedAt: row.updated_at || null
  };
}

function unwrapPrestashopValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  if (Object.prototype.hasOwnProperty.call(value, '#text')) return value['#text'];
  if (Object.prototype.hasOwnProperty.call(value, '_')) return value._;
  return null;
}

function extractPrestashopOrders(payload) {
  if (!payload || typeof payload !== 'object') return [];

  if (Array.isArray(payload.orders)) return payload.orders;
  if (payload.orders && Array.isArray(payload.orders.order)) return payload.orders.order;
  if (Array.isArray(payload.order)) return payload.order;

  if (payload.orders && typeof payload.orders === 'object') {
    const values = Object.values(payload.orders).filter((item) => item && typeof item === 'object');
    if (values.length > 0) return values;
  }

  return [];
}

function normalizePrestashopOrder(rawOrder) {
  const id = unwrapPrestashopValue(rawOrder?.id);
  const reference = unwrapPrestashopValue(rawOrder?.reference);
  const state = unwrapPrestashopValue(rawOrder?.current_state);
  const total = unwrapPrestashopValue(rawOrder?.total_paid);
  const createdAt = unwrapPrestashopValue(rawOrder?.date_add);
  const customerId = unwrapPrestashopValue(rawOrder?.id_customer);

  const totalParsed = Number(total);

  return {
    id: id === null || id === undefined ? null : String(id),
    reference: reference ? String(reference) : '-',
    currentState: state === null || state === undefined ? null : String(state),
    totalPaid: Number.isFinite(totalParsed) ? totalParsed : null,
    customerId: customerId === null || customerId === undefined ? null : String(customerId),
    dateAdd: createdAt ? String(createdAt) : null
  };
}

function buildPrestashopOrdersUrl(settings, limitOverride) {
  if (!settings.base_url) {
    throw new Error('Configura baseUrl en Ajustes de PrestaShop');
  }

  const baseUrl = normalizePrestashopBaseUrl(settings.base_url);
  const apiRoot = /\/api$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api`;
  const url = new URL(`${apiRoot}/orders`);

  const limit =
    limitOverride === null || limitOverride === undefined
      ? Number(settings.pull_limit || PRESTASHOP_DEFAULTS.pull_limit)
      : parseIntStrict(limitOverride, 'limit');

  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('limit debe estar entre 1 y 200');
  }

  url.searchParams.set('output_format', 'JSON');
  url.searchParams.set(
    'display',
    '[id,reference,current_state,total_paid,date_add,id_customer]'
  );
  url.searchParams.set('sort', '[id_DESC]');
  url.searchParams.set('limit', String(limit));

  if (settings.order_state_filter) {
    const filter = String(settings.order_state_filter)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('|');

    if (filter) {
      url.searchParams.set('filter[current_state]', `[${filter}]`);
    }
  }

  return url;
}

async function ensurePrestashopSettingsStorage(client = pool) {
  await client.query(prestashopSettingsTableSql);
  await client.query(
    'ALTER TABLE integration_prestashop_settings ADD COLUMN IF NOT EXISTS default_warehouse_id INT REFERENCES warehouses(id)'
  );
  await client.query(
    `INSERT INTO integration_prestashop_settings
      (id, base_url, api_key, default_warehouse_id, order_state_filter, pull_limit, timeout_ms, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      PRESTASHOP_DEFAULTS.base_url,
      PRESTASHOP_DEFAULTS.api_key,
      PRESTASHOP_DEFAULTS.default_warehouse_id,
      PRESTASHOP_DEFAULTS.order_state_filter,
      PRESTASHOP_DEFAULTS.pull_limit,
      PRESTASHOP_DEFAULTS.timeout_ms
    ]
  );
}

async function readPrestashopSettings(client = pool) {
  await ensurePrestashopSettingsStorage(client);
  const q = await client.query(
    `SELECT id, base_url, api_key, default_warehouse_id, order_state_filter, pull_limit, timeout_ms, updated_at
     FROM integration_prestashop_settings
     WHERE id = 1`
  );

  if (q.rowCount === 0) {
    return {
      id: 1,
      ...PRESTASHOP_DEFAULTS,
      updated_at: null
    };
  }

  return q.rows[0];
}

async function fetchPrestashopOrders(settings, limitOverride) {
  if (!settings.api_key) {
    throw new Error('Configura apiKey en Ajustes de PrestaShop');
  }

  const url = buildPrestashopOrdersUrl(settings, limitOverride);
  const timeoutMs = Number(settings.timeout_ms || PRESTASHOP_DEFAULTS.timeout_ms);
  const auth = Buffer.from(`${settings.api_key}:`).toString('base64');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Timeout al conectar con PrestaShop (${timeoutMs} ms)`);
    }
    throw new Error(`Error de conexion con PrestaShop: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let payload = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const serviceMessage =
      payload?.errors?.[0]?.message ||
      payload?.error ||
      payload?.message ||
      `PrestaShop devolvio ${response.status}`;
    throw new Error(serviceMessage);
  }

  if (!payload) {
    if (rawBody.trim().startsWith('<')) {
      throw new Error('PrestaShop devolvio XML en lugar de JSON');
    }
    throw new Error('Respuesta invalida de PrestaShop');
  }

  const rawOrders = extractPrestashopOrders(payload);
  const orders = rawOrders
    .map(normalizePrestashopOrder)
    .filter((order) => order.id !== null);

  return {
    requestUrl: url.toString(),
    count: orders.length,
    orders
  };
}

async function fetchPrestashopJsonResource(settings, resourcePath, queryParams = {}) {
  if (!settings.api_key) {
    throw new Error('Configura apiKey en Ajustes de PrestaShop');
  }

  if (!settings.base_url) {
    throw new Error('Configura baseUrl en Ajustes de PrestaShop');
  }

  const baseUrl = normalizePrestashopBaseUrl(settings.base_url);
  const apiRoot = /\/api$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api`;
  const cleanResource = String(resourcePath || '').replace(/^\/+/, '');
  const url = new URL(`${apiRoot}/${cleanResource}`);
  const timeoutMs = Number(settings.timeout_ms || PRESTASHOP_DEFAULTS.timeout_ms);
  const auth = Buffer.from(`${settings.api_key}:`).toString('base64');

  for (const [key, value] of Object.entries(queryParams || {})) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  if (!url.searchParams.has('output_format')) {
    url.searchParams.set('output_format', 'JSON');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Timeout al conectar con PrestaShop (${timeoutMs} ms)`);
    }
    throw new Error(`Error de conexion con PrestaShop: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let payload = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const serviceMessage =
      payload?.errors?.[0]?.message ||
      payload?.error ||
      payload?.message ||
      `PrestaShop devolvio ${response.status}`;
    throw new Error(serviceMessage);
  }

  if (!payload) {
    if (rawBody.trim().startsWith('<')) {
      throw new Error('PrestaShop devolvio XML en lugar de JSON');
    }
    throw new Error('Respuesta invalida de PrestaShop');
  }

  return { payload, requestUrl: url.toString() };
}

function extractPrestashopSingleOrder(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order)) {
    return payload.order;
  }
  if (Array.isArray(payload.orders) && payload.orders.length > 0) return payload.orders[0];
  if (
    payload.orders &&
    typeof payload.orders === 'object' &&
    payload.orders.order &&
    typeof payload.orders.order === 'object' &&
    !Array.isArray(payload.orders.order)
  ) {
    return payload.orders.order;
  }
  return null;
}

function extractPrestashopOrderRows(rawOrder) {
  const association = rawOrder?.associations?.order_rows;
  if (!association) return [];
  if (Array.isArray(association)) return association;
  if (Array.isArray(association.order_row)) return association.order_row;
  if (association.order_row && typeof association.order_row === 'object') {
    return [association.order_row];
  }
  return [];
}

function normalizePrestashopOrderRow(rawRow) {
  const qty = Number(unwrapPrestashopValue(rawRow?.product_quantity) ?? 0);
  const sourceSku = String(
    unwrapPrestashopValue(rawRow?.product_reference) ||
      unwrapPrestashopValue(rawRow?.reference) ||
      ''
  )
    .trim()
    .toUpperCase();

  const sourceBarcode = String(
    unwrapPrestashopValue(rawRow?.product_ean13) ||
      unwrapPrestashopValue(rawRow?.ean13) ||
      unwrapPrestashopValue(rawRow?.product_upc) ||
      ''
  )
    .trim()
    .toUpperCase();

  return {
    sourceSku: sourceSku || null,
    sourceBarcode: sourceBarcode || null,
    productName: String(unwrapPrestashopValue(rawRow?.product_name) || 'Producto sin nombre'),
    qty: Number.isFinite(qty) ? qty : 0,
    productId: unwrapPrestashopValue(rawRow?.product_id),
    productAttributeId: unwrapPrestashopValue(rawRow?.product_attribute_id)
  };
}

async function createOrderWithReservations(client, { warehouseId, lines, source, externalId }) {
  const orderQ = await client.query(
    `INSERT INTO orders (external_id, source, status, warehouse_id)
     VALUES ($1,$2,'pending',$3) RETURNING *`,
    [externalId || null, source || 'manual', warehouseId]
  );
  const order = orderQ.rows[0];

  for (const line of lines) {
    const variantId = parseIntStrict(line?.variantId, 'variantId');
    const qty = parseIntStrict(line?.qty, 'qty');
    if (qty <= 0) throw new Error('Cantidad de linea invalida');

    await applyMovement(client, {
      variantId,
      warehouseId,
      type: 'reserve',
      qty,
      note: `Reserva pedido ${order.id}`,
      actor: 'orders-service'
    });

    await client.query(
      `INSERT INTO order_lines (order_id, variant_id, qty_ordered, qty_reserved, qty_picked)
       VALUES ($1,$2,$3,$3,0)`,
      [order.id, variantId, qty]
    );
  }

  return { orderId: Number(order.id) };
}

async function buildPrestashopOrderPreview(settings, prestashopOrderId, warehouseIdOverride) {
  const { payload, requestUrl } = await fetchPrestashopJsonResource(
    settings,
    `orders/${prestashopOrderId}`,
    { display: 'full' }
  );
  const rawOrder = extractPrestashopSingleOrder(payload);
  if (!rawOrder) throw new Error('No se pudo leer el pedido de PrestaShop');

  const normalizedOrder = normalizePrestashopOrder(rawOrder);
  const externalOrderId = `PRESTA-${prestashopOrderId}`;
  const targetWarehouseId =
    warehouseIdOverride || Number(settings.default_warehouse_id || 0) || null;

  if (!targetWarehouseId) {
    throw new Error('Selecciona almacen o configura uno por defecto en Ajustes');
  }

  const rows = extractPrestashopOrderRows(rawOrder)
    .map(normalizePrestashopOrderRow)
    .filter((row) => row.qty > 0);

  if (rows.length === 0) {
    throw new Error('El pedido de PrestaShop no contiene lineas importables');
  }

  const variantsQ = await pool.query(
    `SELECT v.id, v.sku, UPPER(COALESCE(v.barcode, '')) AS barcode, UPPER(COALESCE(v.qr_code, '')) AS qr_code,
            p.name AS product_name, p.strain AS product_strain
     FROM product_variants v
     JOIN products p ON p.id = v.product_id`
  );

  const variantsBySku = new Map();
  const variantsByBarcode = new Map();
  for (const variant of variantsQ.rows) {
    variantsBySku.set(String(variant.sku || '').toUpperCase(), variant);
    if (variant.barcode) variantsByBarcode.set(String(variant.barcode).toUpperCase(), variant);
    if (variant.qr_code) variantsByBarcode.set(String(variant.qr_code).toUpperCase(), variant);
  }

  const mappedLines = [];
  const unmappedLines = [];

  for (const row of rows) {
    const variant =
      (row.sourceSku && variantsBySku.get(row.sourceSku)) ||
      (row.sourceBarcode && variantsByBarcode.get(row.sourceBarcode)) ||
      null;

    if (!variant) {
      unmappedLines.push({
        ...row,
        reason: 'No existe variante local con ese SKU/barcode'
      });
      continue;
    }

    mappedLines.push({
      ...row,
      variantId: Number(variant.id),
      variantSku: variant.sku,
      variantName: variant.product_strain || variant.product_name
    });
  }

  const availabilityByVariant = new Map();
  const variantIds = mappedLines.map((line) => Number(line.variantId));
  if (variantIds.length > 0) {
    const availabilityQ = await pool.query(
      `SELECT variant_id, (on_hand - reserved) AS available
       FROM stock_balance
       WHERE warehouse_id = $1
         AND variant_id = ANY($2::int[])`,
      [targetWarehouseId, variantIds]
    );

    for (const row of availabilityQ.rows) {
      availabilityByVariant.set(Number(row.variant_id), asNumber(row.available));
    }
  }

  const mappedWithStock = mappedLines.map((line) => {
    const available = availabilityByVariant.get(Number(line.variantId)) || 0;
    return {
      ...line,
      available,
      enoughStock: available >= line.qty
    };
  });

  const pendingQty = rows.reduce((acc, line) => acc + asNumber(line.qty), 0);
  const mappedQty = mappedWithStock.reduce((acc, line) => acc + asNumber(line.qty), 0);
  const insufficientCount = mappedWithStock.filter((line) => !line.enoughStock).length;

  return {
    requestUrl,
    order: normalizedOrder,
    externalOrderId,
    warehouseId: targetWarehouseId,
    mappedLines: mappedWithStock,
    unmappedLines,
    totals: {
      lines: rows.length,
      units: pendingQty,
      mappedUnits: mappedQty,
      unmappedLines: unmappedLines.length,
      insufficientLines: insufficientCount
    }
  };
}

function isPrestashopAutoSyncReady(settings) {
  return Boolean(
    settings &&
      settings.base_url &&
      settings.api_key &&
      Number(settings.default_warehouse_id || 0) > 0
  );
}

async function autoImportPrestashopOrdersToQueue() {
  const settings = await readPrestashopSettings();
  if (!isPrestashopAutoSyncReady(settings)) {
    return { ok: true, skipped: true, reason: 'missing-prestashop-config' };
  }

  let result;
  try {
    result = await fetchPrestashopOrders(settings);
  } catch (e) {
    console.error('Prestashop auto-sync fetch failed:', e.message);
    return { ok: false, error: e.message };
  }

  const orders = Array.isArray(result?.orders) ? result.orders : [];
  if (orders.length === 0) {
    return { ok: true, imported: 0, alreadyImported: 0, skipped: 0, failed: 0 };
  }

  const targetWarehouseId = Number(settings.default_warehouse_id);
  let imported = 0;
  let alreadyImported = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    const prestashopOrderId = Number(order?.id);
    if (!Number.isInteger(prestashopOrderId) || prestashopOrderId <= 0) {
      skipped += 1;
      continue;
    }

    const externalOrderId = `PRESTA-${prestashopOrderId}`;
    const existingQ = await pool.query('SELECT id FROM orders WHERE external_id = $1 LIMIT 1', [
      externalOrderId
    ]);

    if (existingQ.rowCount > 0) {
      alreadyImported += 1;
      continue;
    }

    let preview;
    try {
      preview = await buildPrestashopOrderPreview(settings, prestashopOrderId, targetWarehouseId);
    } catch (_e) {
      skipped += 1;
      continue;
    }

    if (
      preview.unmappedLines.length > 0 ||
      preview.mappedLines.length === 0 ||
      preview.mappedLines.some((line) => !line.enoughStock)
    ) {
      skipped += 1;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingLockedQ = await client.query(
        `SELECT id
         FROM orders
         WHERE external_id = $1
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [externalOrderId]
      );

      if (existingLockedQ.rowCount > 0) {
        await client.query('COMMIT');
        alreadyImported += 1;
        continue;
      }

      await createOrderWithReservations(client, {
        warehouseId: preview.warehouseId,
        lines: preview.mappedLines.map((line) => ({
          variantId: line.variantId,
          qty: line.qty
        })),
        source: 'prestashop',
        externalId: externalOrderId
      });

      await client.query('COMMIT');
      imported += 1;
    } catch (e) {
      await client.query('ROLLBACK');
      failed += 1;
      console.error(`Prestashop auto-sync import failed for PRESTA-${prestashopOrderId}:`, e.message);
    } finally {
      client.release();
    }
  }

  return { ok: true, imported, alreadyImported, skipped, failed };
}

async function maybeAutoSyncPrestashopQueue() {
  const now = Date.now();
  if (prestashopAutoSyncInFlight) return prestashopAutoSyncInFlight;
  if (now - prestashopAutoSyncLastRunMs < PRESTASHOP_AUTO_SYNC_MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: 'throttled' };
  }

  prestashopAutoSyncInFlight = (async () => {
    try {
      return await autoImportPrestashopOrdersToQueue();
    } finally {
      prestashopAutoSyncLastRunMs = Date.now();
      prestashopAutoSyncInFlight = null;
    }
  })();

  return prestashopAutoSyncInFlight;
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ ok: true, service: 'api', db: 'ok', redis: 'ok' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/setup/init', async (_req, res) => {
  try {
    await pool.query(schemaSql);
    await ensureProductImageStorage();
    await ensurePrestashopSettingsStorage();
    await pool.query(
      `INSERT INTO warehouses (code, name) VALUES
       ('ALM1', 'Almacén 1'),
       ('ALM2', 'Almacén 2')
       ON CONFLICT (code) DO NOTHING`
    );
    res.json({ ok: true, message: 'Schema aplicado' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({
    project: 'cannabis-stock-platform',
    phase: 'mvp-hardening',
    modules: ['catalog', 'inventory-ledger', 'orders-reservations', 'picking', 'transfers', 'prestashop-bridge', 'warehouse-ui-multipage']
  });
});

app.get('/api/integrations/prestashop/settings', async (_req, res) => {
  try {
    const settings = await readPrestashopSettings();
    res.json({ ok: true, settings: toPublicPrestashopSettings(settings) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/integrations/prestashop/settings', async (req, res) => {
  try {
    const current = await readPrestashopSettings();
    const next = normalizePrestashopPayload(req.body || {}, current);

    await pool.query(
      `INSERT INTO integration_prestashop_settings
        (id, base_url, api_key, default_warehouse_id, order_state_filter, pull_limit, timeout_ms, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE
         SET base_url = EXCLUDED.base_url,
             api_key = EXCLUDED.api_key,
             default_warehouse_id = EXCLUDED.default_warehouse_id,
             order_state_filter = EXCLUDED.order_state_filter,
             pull_limit = EXCLUDED.pull_limit,
             timeout_ms = EXCLUDED.timeout_ms,
             updated_at = NOW()`,
      [
        next.base_url,
        next.api_key,
        next.default_warehouse_id,
        next.order_state_filter,
        next.pull_limit,
        next.timeout_ms
      ]
    );

    const updated = await readPrestashopSettings();
    res.json({ ok: true, settings: toPublicPrestashopSettings(updated) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/integrations/prestashop/test', async (req, res) => {
  try {
    const current = await readPrestashopSettings();
    const merged = normalizePrestashopPayload(req.body || {}, current);
    const result = await fetchPrestashopOrders(merged);

    res.json({
      ok: true,
      message: 'Conexion correcta con PrestaShop',
      requestUrl: result.requestUrl,
      count: result.count,
      preview: result.orders.slice(0, 10)
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/integrations/prestashop/orders', async (req, res) => {
  try {
    const settings = await readPrestashopSettings();
    const result = await fetchPrestashopOrders(settings, req.query.limit);

    res.json({
      ok: true,
      source: 'prestashop',
      requestUrl: result.requestUrl,
      count: result.count,
      pulledAt: new Date().toISOString(),
      orders: result.orders
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/integrations/prestashop/orders/:orderId/preview', async (req, res) => {
  try {
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    const warehouseId = req.query.warehouseId
      ? parseIntStrict(req.query.warehouseId, 'warehouseId')
      : null;

    const settings = await readPrestashopSettings();
    const preview = await buildPrestashopOrderPreview(settings, orderId, warehouseId);
    const existingOrderQ = await pool.query(
      `SELECT id, status, warehouse_id
       FROM orders
       WHERE external_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [preview.externalOrderId]
    );

    res.json({
      ok: true,
      preview,
      existingOrder: existingOrderQ.rowCount > 0 ? existingOrderQ.rows[0] : null
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/integrations/prestashop/orders/:orderId/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    const warehouseId = req.body?.warehouseId
      ? parseIntStrict(req.body.warehouseId, 'warehouseId')
      : null;
    const settings = await readPrestashopSettings();
    const preview = await buildPrestashopOrderPreview(settings, orderId, warehouseId);

    if (preview.unmappedLines.length > 0) {
      throw new Error('Hay lineas sin mapear. Corrige SKU/barcode antes de importar');
    }

    if (preview.mappedLines.some((line) => !line.enoughStock)) {
      throw new Error('Stock insuficiente para una o mas lineas del pedido');
    }

    await client.query('BEGIN');
    const existingOrderQ = await client.query(
      `SELECT id, status
       FROM orders
       WHERE external_id = $1
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [preview.externalOrderId]
    );

    if (existingOrderQ.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyImported: true,
        orderId: Number(existingOrderQ.rows[0].id),
        status: existingOrderQ.rows[0].status
      });
    }

    const created = await createOrderWithReservations(client, {
      warehouseId: preview.warehouseId,
      lines: preview.mappedLines.map((line) => ({
        variantId: line.variantId,
        qty: line.qty
      })),
      source: 'prestashop',
      externalId: preview.externalOrderId
    });

    await client.query('COMMIT');
    res.json({
      ok: true,
      imported: true,
      orderId: created.orderId,
      warehouseId: preview.warehouseId
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/warehouses', async (_req, res) => {
  const q = await pool.query('SELECT * FROM warehouses ORDER BY id');
  res.json(q.rows);
});

app.post('/api/products', async (req, res) => {
  try {
    await ensureProductImageStorage();
    const name = String(req.body?.name || '').trim();
    const strain = req.body?.strain ? String(req.body.strain).trim() : null;
    const imageUrl = normalizeProductImageReference(req.body?.imageUrl);
    if (!name) throw new Error('El nombre de producto es obligatorio');

    const q = await pool.query(
      'INSERT INTO products (name, strain, image_url) VALUES ($1,$2,$3) RETURNING *',
      [name, strain, imageUrl]
    );
    res.json(q.rows[0]);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/products', async (_req, res) => {
  await ensureProductImageStorage();
  const q = await pool.query('SELECT * FROM products ORDER BY id DESC');
  res.json(q.rows);
});

app.post('/api/variants', async (req, res) => {
  try {
    const productId = parseIntStrict(req.body?.productId, 'productId');
    const packSize = parseIntStrict(req.body?.packSize, 'packSize');
    const sku = String(req.body?.sku || '').trim().toUpperCase();
    const barcode = req.body?.barcode ? String(req.body.barcode).trim() : null;
    const qrCode = req.body?.qrCode ? String(req.body.qrCode).trim() : null;

    if (!ALLOWED_PACK_SIZES.includes(packSize)) {
      throw new Error(`packSize inválido. Permitidos: ${ALLOWED_PACK_SIZES.join(', ')}`);
    }
    if (!sku) throw new Error('SKU obligatorio');

    const q = await pool.query(
      `INSERT INTO product_variants (product_id, pack_size, sku, barcode, qr_code)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [productId, packSize, sku, barcode, qrCode]
    );

    res.json(q.rows[0]);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/variants', async (_req, res) => {
  await ensureProductImageStorage();
  const q = await pool.query(
    `SELECT v.*, p.name AS product_name, p.strain AS product_strain, p.image_url AS product_image
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     ORDER BY p.name ASC, v.pack_size ASC`
  );
  res.json(q.rows);
});

app.post('/api/inventory/movements', async (req, res) => {
  const client = await pool.connect();
  try {
    const variantId = parseIntStrict(req.body?.variantId, 'variantId');
    const warehouseId = parseIntStrict(req.body?.warehouseId, 'warehouseId');
    const qty = parseIntStrict(req.body?.qty, 'qty');
    const type = String(req.body?.type || 'in');
    const note = req.body?.note || null;
    const actor = req.body?.actor || 'system';

    if (qty <= 0) throw new Error('qty debe ser > 0');

    await client.query('BEGIN');
    const balance = await applyMovement(client, { variantId, warehouseId, type, qty, note, actor });
    await client.query('COMMIT');
    res.json({ ok: true, balance });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/balance', async (_req, res) => {
  const q = await pool.query(
    `SELECT sb.variant_id, sb.warehouse_id, sb.on_hand, sb.reserved, (sb.on_hand - sb.reserved) AS available,
            v.sku, v.pack_size, p.name AS product_name, w.name AS warehouse_name
     FROM stock_balance sb
     JOIN product_variants v ON v.id = sb.variant_id
     JOIN products p ON p.id = v.product_id
     JOIN warehouses w ON w.id = sb.warehouse_id
     ORDER BY p.name, v.pack_size`
  );
  res.json(q.rows);
});

app.get('/api/dashboard/summary', async (_req, res) => {
  try {
    const [ordersQ, invQ, linesQ] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status`),
      pool.query(`SELECT COUNT(*)::int AS low_stock FROM stock_balance WHERE (on_hand - reserved) <= 10`),
      pool.query(`SELECT COALESCE(SUM(qty_ordered - qty_picked),0)::int AS pending_lines FROM order_lines`)
    ]);

    const orders = { pending: 0, picking: 0, completed: 0 };
    for (const row of ordersQ.rows) {
      orders[row.status] = Number(row.count);
    }

    res.json({
      ok: true,
      orders,
      lowStockSkus: Number(invQ.rows[0]?.low_stock || 0),
      pendingLines: Number(linesQ.rows[0]?.pending_lines || 0)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/transfers', async (req, res) => {
  const client = await pool.connect();
  try {
    const variantId = parseIntStrict(req.body?.variantId, 'variantId');
    const fromWarehouseId = parseIntStrict(req.body?.fromWarehouseId, 'fromWarehouseId');
    const toWarehouseId = parseIntStrict(req.body?.toWarehouseId, 'toWarehouseId');
    const qty = parseIntStrict(req.body?.qty, 'qty');
    const actor = req.body?.actor || 'transfer-service';
    const note = req.body?.note || null;

    if (fromWarehouseId === toWarehouseId) throw new Error('El almacén origen y destino deben ser distintos');
    if (qty <= 0) throw new Error('qty debe ser > 0');

    await client.query('BEGIN');

    await applyMovement(client, {
      variantId,
      warehouseId: fromWarehouseId,
      type: 'out',
      qty,
      note: note || `Traspaso salida hacia almacén ${toWarehouseId}`,
      actor
    });

    await applyMovement(client, {
      variantId,
      warehouseId: toWarehouseId,
      type: 'in',
      qty,
      note: note || `Traspaso entrada desde almacén ${fromWarehouseId}`,
      actor
    });

    const transferQ = await client.query(
      `INSERT INTO stock_transfers (variant_id, from_warehouse_id, to_warehouse_id, qty, note, actor)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [variantId, fromWarehouseId, toWarehouseId, qty, note, actor]
    );

    await client.query('COMMIT');
    res.json({ ok: true, transfer: transferQ.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/transfers', async (_req, res) => {
  const q = await pool.query(
    `SELECT t.*, v.sku, v.pack_size, p.name AS product_name,
            wf.name AS from_warehouse_name, wt.name AS to_warehouse_name
     FROM stock_transfers t
     JOIN product_variants v ON v.id = t.variant_id
     JOIN products p ON p.id = v.product_id
     JOIN warehouses wf ON wf.id = t.from_warehouse_id
     JOIN warehouses wt ON wt.id = t.to_warehouse_id
     ORDER BY t.id DESC
     LIMIT 300`
  );
  res.json(q.rows);
});

app.post('/api/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const warehouseId = parseIntStrict(req.body?.warehouseId, 'warehouseId');
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const source = req.body?.source || 'manual';
    const externalId = req.body?.externalId ? String(req.body.externalId) : null;

    if (lines.length === 0) throw new Error('Debe incluir al menos una linea');

    await client.query('BEGIN');
    const created = await createOrderWithReservations(client, {
      warehouseId,
      lines,
      source,
      externalId
    });

    await client.query('COMMIT');
    res.json({ ok: true, orderId: created.orderId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  const { status } = req.query;
  const q = status
    ? await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY id DESC', [status])
    : await pool.query('SELECT * FROM orders ORDER BY id DESC');
  res.json(q.rows);
});

app.get('/api/orders/queue', async (req, res) => {
  try {
    try {
      await maybeAutoSyncPrestashopQueue();
    } catch (syncError) {
      console.error('Prestashop auto-sync warning:', syncError.message);
    }

    const includeCompleted = String(req.query.includeCompleted || 'false') === 'true';
    const source = String(req.query.source || 'all')
      .trim()
      .toLowerCase();

    if (!['all', 'manual', 'prestashop'].includes(source)) {
      return res.status(400).json({ ok: false, error: 'source debe ser all, manual o prestashop' });
    }

    const filters = [];
    const params = [];

    if (!includeCompleted) {
      filters.push("o.status <> 'completed'");
    }

    if (source !== 'all') {
      params.push(source);
      filters.push(`LOWER(o.source) = $${params.length}`);
    }

    const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const q = await pool.query(
      `SELECT o.id, o.external_id, o.status, o.source, o.warehouse_id, o.created_at,
              w.name AS warehouse_name,
              COALESCE(SUM(ol.qty_ordered), 0) AS total_qty,
              COALESCE(SUM(ol.qty_picked), 0) AS picked_qty,
              COUNT(ol.id) AS lines_count,
              CASE
                WHEN COALESCE(SUM(ol.qty_ordered), 0) = 0 THEN 0
                ELSE ROUND((COALESCE(SUM(ol.qty_picked), 0)::numeric / SUM(ol.qty_ordered)::numeric) * 100, 2)
              END AS progress_pct
       FROM orders o
       LEFT JOIN order_lines ol ON ol.order_id = o.id
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       ${whereSql}
       GROUP BY o.id, w.name
       ORDER BY o.id DESC`,
      params
    );

    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/orders/:orderId', async (req, res) => {
  try {
    await ensureProductImageStorage();
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    const orderQ = await pool.query(
      `SELECT o.*, w.name AS warehouse_name
       FROM orders o
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (orderQ.rowCount === 0) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    const linesQ = await pool.query(
      `SELECT ol.*, v.sku, v.pack_size, v.barcode, v.qr_code,
              p.name AS product_name, p.strain AS product_strain, p.image_url AS product_image
       FROM order_lines ol
       JOIN product_variants v ON v.id = ol.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE ol.order_id = $1
       ORDER BY ol.id`,
      [orderId]
    );

    res.json({
      ...orderQ.rows[0],
      lines: linesQ.rows,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/orders/:orderId/lines', async (req, res) => {
  await ensureProductImageStorage();
  const { orderId } = req.params;
  const q = await pool.query(
    `SELECT ol.*, v.sku, v.pack_size, v.barcode, v.qr_code,
            p.name AS product_name, p.strain AS product_strain, p.image_url AS product_image
     FROM order_lines ol
     JOIN product_variants v ON v.id = ol.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE ol.order_id = $1
     ORDER BY ol.id`,
    [orderId]
  );
  res.json(q.rows);
});

app.post('/api/orders/:orderId/lines/:lineId/adjust', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureProductImageStorage(client);
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    const lineId = parseIntStrict(req.params.lineId, 'lineId');
    const payload = req.body || {};
    const actor = payload.actor || 'picking-ui';
    const hasVariantId = Object.prototype.hasOwnProperty.call(payload, 'variantId');
    const hasQtyOrdered = Object.prototype.hasOwnProperty.call(payload, 'qtyOrdered');
    const nextVariantId = hasVariantId
      ? payload.variantId === null || payload.variantId === ''
        ? null
        : parseIntStrict(payload.variantId, 'variantId')
      : null;
    const nextQty = hasQtyOrdered
      ? payload.qtyOrdered === null || payload.qtyOrdered === ''
        ? null
        : parseIntStrict(payload.qtyOrdered, 'qtyOrdered')
      : null;

    if (!hasVariantId && !hasQtyOrdered) {
      throw new Error('Debes indicar variantId o qtyOrdered');
    }

    await client.query('BEGIN');

    const orderQ = await client.query(
      'SELECT id, status, warehouse_id FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (orderQ.rowCount === 0) throw new Error('Pedido no encontrado');

    const order = orderQ.rows[0];
    if (order.status === 'completed') {
      throw new Error('No se puede ajustar un pedido completado');
    }
    if (!order.warehouse_id) throw new Error('Pedido sin almacen asignado');

    const lineQ = await client.query(
      'SELECT * FROM order_lines WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [lineId, orderId]
    );
    if (lineQ.rowCount === 0) throw new Error('Linea no encontrada en el pedido');

    const line = lineQ.rows[0];
    const currentVariantId = Number(line.variant_id);
    const currentReserved = Number(line.qty_reserved);
    const currentPicked = Number(line.qty_picked);

    const finalVariantId = nextVariantId === null ? currentVariantId : nextVariantId;
    const finalQtyOrdered = nextQty === null ? Number(line.qty_ordered) : nextQty;

    if (finalQtyOrdered <= 0) throw new Error('qtyOrdered debe ser mayor que 0');
    if (finalQtyOrdered < currentPicked) {
      throw new Error('No puedes dejar qtyOrdered por debajo de lo ya escaneado');
    }
    if (finalVariantId !== currentVariantId && currentPicked > 0) {
      throw new Error('No puedes cambiar la variante de una linea con unidades ya escaneadas');
    }
    if (finalVariantId !== currentVariantId) {
      const variantExistsQ = await client.query('SELECT id FROM product_variants WHERE id = $1', [finalVariantId]);
      if (variantExistsQ.rowCount === 0) {
        throw new Error('La variante seleccionada no existe');
      }
    }

    if (finalVariantId === currentVariantId) {
      const diff = finalQtyOrdered - currentReserved;
      if (diff > 0) {
        await applyMovement(client, {
          variantId: currentVariantId,
          warehouseId: Number(order.warehouse_id),
          type: 'reserve',
          qty: diff,
          note: `Ajuste manual +reserva pedido ${orderId} linea ${lineId}`,
          actor
        });
      } else if (diff < 0) {
        await applyMovement(client, {
          variantId: currentVariantId,
          warehouseId: Number(order.warehouse_id),
          type: 'release',
          qty: Math.abs(diff),
          note: `Ajuste manual -reserva pedido ${orderId} linea ${lineId}`,
          actor
        });
      }
    } else {
      await applyMovement(client, {
        variantId: currentVariantId,
        warehouseId: Number(order.warehouse_id),
        type: 'release',
        qty: currentReserved,
        note: `Cambio variante linea ${lineId} pedido ${orderId} - liberar reserva`,
        actor
      });

      await applyMovement(client, {
        variantId: finalVariantId,
        warehouseId: Number(order.warehouse_id),
        type: 'reserve',
        qty: finalQtyOrdered,
        note: `Cambio variante linea ${lineId} pedido ${orderId} - nueva reserva`,
        actor
      });
    }

    await client.query(
      `UPDATE order_lines
       SET variant_id = $1, qty_ordered = $2, qty_reserved = $2
       WHERE id = $3`,
      [finalVariantId, finalQtyOrdered, lineId]
    );

    const updatedLineQ = await client.query(
      `SELECT ol.*, v.sku, v.pack_size, v.barcode, v.qr_code,
              p.name AS product_name, p.strain AS product_strain, p.image_url AS product_image
       FROM order_lines ol
       JOIN product_variants v ON v.id = ol.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE ol.id = $1`,
      [lineId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, line: updatedLineQ.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/orders/:orderId/start', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    await client.query('BEGIN');

    const orderQ = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderQ.rowCount === 0) throw new Error('Pedido no encontrado');

    const order = orderQ.rows[0];
    if (order.status === 'completed') throw new Error('Pedido ya completado');

    if (order.status === 'pending') {
      await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['picking', orderId]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, orderId, status: 'picking' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/picking/scan', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderId = parseIntStrict(req.body?.orderId, 'orderId');
    const sku = String(req.body?.sku || '').trim().toUpperCase();
    const qty = parseIntStrict(req.body?.qty || 1, 'qty');

    if (!sku) throw new Error('SKU requerido');
    if (qty <= 0) throw new Error('qty debe ser > 0');

    await client.query('BEGIN');

    const orderQ = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderQ.rowCount === 0) throw new Error('Pedido no encontrado');
    const order = orderQ.rows[0];

    if (order.status === 'completed') throw new Error('Pedido ya completado');
    if (order.status === 'pending') {
      await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['picking', orderId]);
    }

    const lineQ = await client.query(
      `SELECT ol.* FROM order_lines ol
       JOIN product_variants v ON v.id = ol.variant_id
       WHERE ol.order_id = $1
         AND ol.qty_picked < ol.qty_ordered
         AND (
           UPPER(v.sku) = $2
           OR UPPER(COALESCE(v.barcode, '')) = $2
           OR UPPER(COALESCE(v.qr_code, '')) = $2
         )
       ORDER BY ol.id
       LIMIT 1
       FOR UPDATE`,
      [orderId, sku]
    );

    if (lineQ.rowCount === 0) {
      const alreadyCompletedQ = await client.query(
        `SELECT 1
         FROM order_lines ol
         JOIN product_variants v ON v.id = ol.variant_id
         WHERE ol.order_id = $1
           AND (
             UPPER(v.sku) = $2
             OR UPPER(COALESCE(v.barcode, '')) = $2
             OR UPPER(COALESCE(v.qr_code, '')) = $2
           )
         LIMIT 1`,
        [orderId, sku]
      );

      if (alreadyCompletedQ.rowCount > 0) {
        throw new Error('Ese SKU ya esta completo en el pedido');
      }

      throw new Error('SKU no pertenece al pedido');
    }
    const line = lineQ.rows[0];

    const newPicked = Number(line.qty_picked) + qty;
    if (newPicked > Number(line.qty_ordered)) throw new Error('Escaneo excede cantidad pendiente');

    await client.query('UPDATE order_lines SET qty_picked = $1 WHERE id = $2', [newPicked, line.id]);

    await client.query('COMMIT');
    res.json({ ok: true, lineId: Number(line.id), qtyPicked: newPicked, qtyOrdered: Number(line.qty_ordered) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/picking/complete/:orderId', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderId = parseIntStrict(req.params.orderId, 'orderId');
    await client.query('BEGIN');

    const orderQ = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderQ.rowCount === 0) throw new Error('Pedido no encontrado');
    const order = orderQ.rows[0];
    if (order.status === 'completed') throw new Error('Pedido ya completado');

    const linesQ = await client.query('SELECT * FROM order_lines WHERE order_id = $1 FOR UPDATE', [orderId]);
    const lines = linesQ.rows;
    if (lines.length === 0) throw new Error('Pedido sin líneas');

    for (const line of lines) {
      if (Number(line.qty_picked) !== Number(line.qty_ordered)) {
        throw new Error(`Linea ${line.id} incompleta (${line.qty_picked}/${line.qty_ordered})`);
      }
    }

    for (const line of lines) {
      const qtyReserved = Number(line.qty_reserved);
      const qtyShipped = Number(line.qty_picked);

      // Reserva y salida se registran por separado para trazabilidad.
      if (qtyReserved > 0) {
        await applyMovement(client, {
          variantId: Number(line.variant_id),
          warehouseId: Number(order.warehouse_id),
          type: 'release',
          qty: qtyReserved,
          note: `Liberacion reserva pedido ${orderId}`,
          actor: 'picking-service'
        });
      }

      if (qtyShipped > 0) {
        await applyMovement(client, {
          variantId: Number(line.variant_id),
          warehouseId: Number(order.warehouse_id),
          type: 'out',
          qty: qtyShipped,
          note: `Salida pedido ${orderId}`,
          actor: 'picking-service'
        });
      }

      await client.query('UPDATE order_lines SET qty_reserved = 0 WHERE id = $1', [line.id]);
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['completed', orderId]);
    await client.query('COMMIT');
    res.json({ ok: true, orderId, status: 'completed' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/integrations/prestashop/import-order', async (req, res) => {
  try {
    const { externalOrderId, warehouseId, lines } = req.body;
    const response = await fetch(`http://localhost:${port}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        externalId: String(externalOrderId),
        source: 'prestashop',
        warehouseId,
        lines
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(400).json(data);
    res.json({ ok: true, imported: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/integrations/prestashop/push-stock', async (_req, res) => {
  try {
    const q = await pool.query(
      `SELECT v.sku, sb.warehouse_id, sb.on_hand, sb.reserved, (sb.on_hand - sb.reserved) AS available
       FROM stock_balance sb
       JOIN product_variants v ON v.id = sb.variant_id
       ORDER BY v.sku, sb.warehouse_id`
    );

    res.json({
      ok: true,
      mode: 'mock',
      message: 'Payload listo para enviar a PrestaShop API',
      stockPayload: q.rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/demo/seed', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureProductImageStorage(client);
    const demoImage = DEFAULT_PRODUCT_IMAGE_URL;

    const pQ = await client.query(
      `INSERT INTO products (name, strain, image_url)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      ['Gorilla Glue', 'Hibrida', demoImage]
    );

    let productId;
    if (pQ.rowCount > 0) {
      productId = pQ.rows[0].id;
    } else {
      const existingP = await client.query(`SELECT id FROM products WHERE name = 'Gorilla Glue' ORDER BY id DESC LIMIT 1`);
      productId = existingP.rows[0].id;
      await client.query(
        `UPDATE products
         SET image_url = COALESCE(NULLIF(TRIM(image_url), ''), $1)
         WHERE id = $2`,
        [demoImage, productId]
      );
    }

    for (const pack of ALLOWED_PACK_SIZES) {
      const sku = `GGL-${pack}`;
      const vQ = await client.query(
        `INSERT INTO product_variants (product_id, pack_size, sku)
         VALUES ($1,$2,$3)
         ON CONFLICT (sku) DO UPDATE SET sku = EXCLUDED.sku
         RETURNING id`,
        [productId, pack, sku]
      );

      const variantId = vQ.rows[0].id;
      await applyMovement(client, {
        variantId,
        warehouseId: 1,
        type: 'in',
        qty: 100,
        note: 'seed demo ALM1',
        actor: 'demo'
      });
      await applyMovement(client, {
        variantId,
        warehouseId: 2,
        type: 'in',
        qty: 50,
        note: 'seed demo ALM2',
        actor: 'demo'
      });
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Datos demo cargados' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`API running on :${port}`);
});

