# Backlog — Sprint 1 (2 semanas)

## Objetivo del sprint
Tener un MVP funcional base: catálogo/variantes, stock ledger, import de pedidos PrestaShop y preparación guiada mínima.

## Historias

### EPIC A — Catálogo y variantes
- [ ] A1. Crear CRUD de productos.
- [ ] A2. Crear variantes por pack (3/5/10/25/100/250).
- [ ] A3. Soporte SKU + barcode/QR por variante.

**Criterio:** variantes visibles y editables desde panel.

### EPIC B — Inventario 2 almacenes
- [ ] B1. Crear entidades de almacenes.
- [ ] B2. Crear ledger de movimientos.
- [ ] B3. Calcular balances on_hand/reserved/available.
- [ ] B4. Endpoint de ajuste manual con auditoría.

**Criterio:** stock consistente por variante y almacén.

### EPIC C — Integración PrestaShop (base)
- [ ] C1. Configuración credenciales PrestaShop en entorno local.
- [ ] C2. Import de pedidos pagados.
- [ ] C3. Reserva automática de stock al importar.
- [ ] C4. Push de stock available por SKU.

**Criterio:** pedido importado + stock publicado correctamente.

### EPIC D — Picking mínimo viable
- [ ] D1. Vista de pedidos pendientes para operario.
- [ ] D2. Iniciar sesión de picking.
- [ ] D3. Escaneo SKU para validar línea.
- [ ] D4. Completar pedido y descontar stock definitivo.

**Criterio:** pedido preparado end-to-end con escáner.

### EPIC E — Calidad y operaciones
- [ ] E1. Logs estructurados API/worker.
- [ ] E2. Manejo de errores y reintentos en sync.
- [ ] E3. Dashboard simple de incidencias de sincronización.

## Definición de hecho (DoD)
- Tests básicos de módulos críticos.
- Validaciones de negocio en backend.
- Auditoría activa en mutaciones de stock.
- Documentación de endpoints principales.

## Riesgos iniciales
- Calidad de datos SKU en PrestaShop.
- Diferencias de nomenclatura entre catálogo actual y futuro.
- Flujo real de almacén no documentado en detalle.

## Datos que faltan para Sprint 2
- Estados exactos de pedido en PrestaShop para cada transición.
- Reglas de asignación de almacén por pedido.
- Formato exacto de códigos (EAN/Code128/QR).
