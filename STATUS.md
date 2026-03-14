# Estado del proyecto — Cannabis Stock Platform

## Estado general
- Fase: MVP operativo multipágina (v3)
- Infra local (Docker): ✅
- Backend de inventario/pedidos/picking: ✅
- Traspasos entre almacenes: ✅
- UI multipágina operativa: ✅
- Integración PrestaShop real: 🟡 pendiente credenciales/mapeo final

## Lo que ya está hecho
- Ledger de stock por almacén (`on_hand`, `reserved`, `available`) con consistencia.
- Catálogo y variantes por packs permitidos (3/5/10/25/100/250).
- Pedidos con reserva automática.
- Picking guiado por SKU y cierre de pedido solo si todo está completo.
- Nueva UX de picking más intuitiva:
  - “siguiente SKU esperado” en grande
  - barra de progreso visible
  - botones rápidos (+1 / completar línea esperada)
  - soporte de escaneo por SKU, barcode o QR
- Traspasos entre almacenes con movimiento doble (salida origen + entrada destino).
- Dashboard con métricas operativas y alertas de stock.

## UI multipágina (nueva)
- `/` → Dashboard
- `/catalog.html` → Catálogo (productos/variantes)
- `/inventory.html` → Inventario y ajustes
- `/orders.html` → Creación y cola de pedidos
- `/picking.html` → Preparación de pedidos con escáner
- `/transfers.html` → Traspasos entre almacenes

## API destacada
- `GET /api/dashboard/summary`
- `POST /api/orders`, `GET /api/orders/queue`
- `POST /api/picking/scan`, `POST /api/picking/complete/:orderId`
- `POST /api/transfers`, `GET /api/transfers`
- `GET /api/inventory/balance`

## Siguiente bloque prioritario
1. Integración real PrestaShop (import pedidos y push stock por SKU).
2. Worker/colas con reintentos para sincronización robusta.
3. Auditoría operativa por usuario y reportes de incidencias.
4. Permisos por rol (admin/supervisor/operario).
