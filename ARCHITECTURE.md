# Arquitectura técnica (MVP)

## Stack
- Frontend: Next.js (panel admin + modo operario)
- Backend: NestJS (API REST + WebSocket)
- DB: PostgreSQL
- Cola: Redis + BullMQ
- Infra local: Docker Compose
- Auth: JWT + RBAC

## Componentes
1. **Web App**
   - Admin: catálogo, inventario, ajustes, reportes.
   - Operario: cola de pedidos, picking guiado por escáner.
2. **API Core**
   - Módulos: Auth, Products, Warehouses, InventoryLedger, Orders, Picking, PrestashopSync, Audit.
3. **Worker**
   - Jobs async de sincronización y reintentos.
4. **PostgreSQL**
   - Fuente de verdad para stock real.
5. **Redis**
   - Cola y caché de operaciones rápidas.

## Modelo de datos (resumen)
- products(id, name, strain, active)
- product_variants(id, product_id, pack_size, sku, barcode, qr_code)
- warehouses(id, name, code)
- stock_balance(variant_id, warehouse_id, on_hand, reserved, updated_at)
- inventory_movements(id, variant_id, warehouse_id, type, qty, ref_type, ref_id, actor_id, created_at)
- orders(id, source='prestashop', external_id, status, warehouse_id, created_at)
- order_lines(id, order_id, variant_id, qty_ordered, qty_reserved, qty_picked)
- picking_sessions(id, order_id, picker_id, status, started_at, completed_at)
- sync_events(id, direction, entity, payload, status, retries, last_error)
- audit_logs(id, actor_id, action, entity, entity_id, metadata, created_at)

## Integración PrestaShop
### Entrada (pull/webhook)
- Pedidos nuevos/pagados -> orders + reservas.
- Idempotencia por external_id.

### Salida (push)
- Publicar available por SKU.
- Actualizar estado de pedido al completar flujo.
- Reintentos con backoff en caso de error.

## Flujo picking
1. Operario toma pedido pendiente.
2. App muestra líneas y cantidades.
3. Escaneo SKU/ubicación.
4. Validación de coincidencia.
5. Confirmar línea.
6. Completar pedido => movimiento de salida definitivo + sync PrestaShop.

## Seguridad
- RBAC por rol.
- Auditoría obligatoria en acciones de inventario.
- Endpoints de integración autenticados por token técnico.
- Registro de errores y eventos de sincronización.

## Despliegue local (docker)
Servicios:
- web
- api
- worker
- postgres
- redis

Red interna docker + volúmenes persistentes.
