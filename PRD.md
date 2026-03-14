# PRD — Plataforma de Gestión de Stock y Preparación de Pedidos (Semillas)

## 1. Objetivo
Construir una plataforma web local-first para gestionar stock real de semillas (2 almacenes), sincronizar con PrestaShop y reducir errores de preparación de pedidos con flujos guiados por escáner.

## 2. Problemas actuales
- Gestión en Excel con errores frecuentes de stock.
- Descuadres entre almacén y web (PrestaShop).
- Fallos en preparación de pedidos por procesos no guiados.
- Falta de trazabilidad de movimientos y responsables.

## 3. Alcance funcional (MVP)
1. Gestión de catálogo/SKU por variante de pack: 3, 5, 10, 25, 100, 250.
2. Stock por almacén con libro de movimientos (ledger): entradas, salidas, ajustes, transferencias, reservas.
3. Integración PrestaShop:
   - Importar pedidos pagados/listos.
   - Publicar stock vendible real por SKU.
4. Módulo de preparación de pedidos con escáner (barcode/microQR).
5. Auditoría completa de operaciones.

## 4. Fuera de alcance inicial
- Facturación propia (se mantiene en PrestaShop/ERP actual).
- WMS avanzado con optimización de ruta IA.
- App móvil nativa (se usa web responsive para pistolas Android).

## 5. Usuarios y roles
- Admin
- Supervisor de almacén
- Operario de picking/packing
- Integración técnica (service account)

## 6. Requisitos clave
- Todo on-prem/local (sin dependencia de SaaS obligatorio).
- Stock en tiempo real y coherente entre almacenes y web.
- Confirmación de pedido solo al finalizar preparación.
- UX simple para operario sin conocimientos técnicos.

## 7. Reglas de negocio
- Stock vendible = on_hand - reserved.
- La reserva se crea al importar pedido válido desde PrestaShop.
- El descuento definitivo de stock ocurre al completar preparación/expedición.
- No permitir completar línea si SKU escaneado no coincide.
- Soportar transferencias entre almacenes con doble confirmación.

## 8. KPIs
- Error de preparación (% pedidos con incidencias).
- Descuadre inventario (% diferencia recuento vs sistema).
- Tiempo medio de preparación por pedido.
- Roturas de stock evitadas en web.

## 9. Criterios de aceptación del MVP
- Sincronización estable de pedidos y stock con PrestaShop.
- Preparación guiada por escáner para 100% de líneas.
- Registro auditable de cada movimiento.
- Operación diaria en 2 almacenes sin Excel.
