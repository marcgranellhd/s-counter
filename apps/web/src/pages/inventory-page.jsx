import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { ProcessGuide } from "@/components/process-guide";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, endpoints } from "@/lib/api";
import { asNumber } from "@/lib/utils";

const MOVEMENT_TYPES = [
  { value: "in", label: "Entrada" },
  { value: "adjust", label: "Ajuste +" },
  { value: "out", label: "Salida" },
  { value: "reserve", label: "Reserva" },
  { value: "release", label: "Liberar reserva" },
];

const DEFAULT_FILTERS = {
  term: "",
  pack: "all",
  stockStatus: "all",
  reservedStatus: "all",
  minAvailable: "",
  maxAvailable: "",
};

function compareByCatalogOrder(a, b) {
  const productA = String(a?.product_name || "");
  const productB = String(b?.product_name || "");
  const productComparison = productA.localeCompare(productB, "es", { sensitivity: "base" });
  if (productComparison !== 0) return productComparison;

  const packComparison = asNumber(b?.pack_size) - asNumber(a?.pack_size);
  if (packComparison !== 0) return packComparison;

  const skuA = String(a?.sku || "");
  const skuB = String(b?.sku || "");
  return skuA.localeCompare(skuB, "es", { sensitivity: "base" });
}

export function InventoryPage() {
  const [inventoryRows, setInventoryRows] = useState([]);
  const [variants, setVariants] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [viewMode, setViewMode] = useState("separate");
  const [warehouseScope, setWarehouseScope] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const [form, setForm] = useState({
    variantId: "",
    warehouseId: "",
    type: "in",
    qty: "",
    note: "",
  });

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [inventoryResponse, variantsResponse, warehousesResponse] = await Promise.all([
        api(endpoints.inventoryBalance),
        api(endpoints.variants),
        api(endpoints.warehouses),
      ]);

      setInventoryRows(inventoryResponse || []);
      setVariants(variantsResponse || []);
      setWarehouses(warehousesResponse || []);

      setForm((current) => ({
        ...current,
        variantId: current.variantId || String(variantsResponse?.[0]?.id || ""),
        warehouseId: current.warehouseId || String(warehousesResponse?.[0]?.id || ""),
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (warehouseScope === "all") return;

    const exists = warehouses.some((warehouse) => String(warehouse.id) === warehouseScope);
    if (!exists) {
      setWarehouseScope("all");
    }
  }, [warehouseScope, warehouses]);

  const packOptions = useMemo(() => {
    const unique = Array.from(
      new Set(inventoryRows.map((row) => asNumber(row.pack_size)).filter((pack) => pack > 0))
    );
    return unique.sort((a, b) => a - b);
  }, [inventoryRows]);

  const minAvailableValue = useMemo(() => {
    if (!String(filters.minAvailable).trim()) return null;
    const parsed = Number(filters.minAvailable);
    return Number.isFinite(parsed) ? parsed : null;
  }, [filters.minAvailable]);

  const maxAvailableValue = useMemo(() => {
    if (!String(filters.maxAvailable).trim()) return null;
    const parsed = Number(filters.maxAvailable);
    return Number.isFinite(parsed) ? parsed : null;
  }, [filters.maxAvailable]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (String(filters.term || "").trim()) count += 1;
    if (filters.pack !== "all") count += 1;
    if (filters.stockStatus !== "all") count += 1;
    if (filters.reservedStatus !== "all") count += 1;
    if (String(filters.minAvailable || "").trim()) count += 1;
    if (String(filters.maxAvailable || "").trim()) count += 1;
    if (warehouseScope !== "all") count += 1;
    return count;
  }, [filters, warehouseScope]);

  const rowMatchesFilters = useCallback(
    (row) => {
      const term = String(filters.term || "").trim().toUpperCase();
      const sku = String(row.sku || "").toUpperCase();
      const productName = String(row.product_name || "").toUpperCase();
      const available = asNumber(row.available);
      const reserved = asNumber(row.reserved);
      const packSize = asNumber(row.pack_size);

      if (term && !sku.includes(term) && !productName.includes(term)) {
        return false;
      }

      if (filters.pack !== "all" && packSize !== Number(filters.pack)) {
        return false;
      }

      if (filters.stockStatus === "critical" && available > 10) {
        return false;
      }
      if (filters.stockStatus === "healthy" && available <= 10) {
        return false;
      }
      if (filters.stockStatus === "zero" && available !== 0) {
        return false;
      }

      if (filters.reservedStatus === "with_reserved" && reserved <= 0) {
        return false;
      }
      if (filters.reservedStatus === "without_reserved" && reserved > 0) {
        return false;
      }

      if (minAvailableValue !== null && available < minAvailableValue) {
        return false;
      }
      if (maxAvailableValue !== null && available > maxAvailableValue) {
        return false;
      }

      return true;
    },
    [filters, minAvailableValue, maxAvailableValue]
  );

  const separateRows = useMemo(() => {
    return inventoryRows
      .filter((row) => {
        if (warehouseScope !== "all" && String(row.warehouse_id) !== warehouseScope) {
          return false;
        }

        return rowMatchesFilters(row);
      })
      .sort((left, right) => {
        const catalogOrder = compareByCatalogOrder(left, right);
        if (catalogOrder !== 0) return catalogOrder;

        const leftWarehouse = String(left?.warehouse_name || "");
        const rightWarehouse = String(right?.warehouse_name || "");
        return leftWarehouse.localeCompare(rightWarehouse, "es", { sensitivity: "base" });
      });
  }, [inventoryRows, rowMatchesFilters, warehouseScope]);

  const mergedRows = useMemo(() => {
    const map = new Map();

    for (const row of inventoryRows) {
      const key = String(row.variant_id || row.sku || "");
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          variant_id: row.variant_id,
          product_name: row.product_name,
          sku: row.sku,
          pack_size: row.pack_size,
          on_hand: asNumber(row.on_hand),
          reserved: asNumber(row.reserved),
          available: asNumber(row.available),
          warehouses: [row.warehouse_name],
        });
        continue;
      }

      existing.on_hand += asNumber(row.on_hand);
      existing.reserved += asNumber(row.reserved);
      existing.available += asNumber(row.available);
      if (!existing.warehouses.includes(row.warehouse_name)) {
        existing.warehouses.push(row.warehouse_name);
      }
    }

    return Array.from(map.values())
      .filter((row) => rowMatchesFilters(row))
      .sort(compareByCatalogOrder);
  }, [inventoryRows, rowMatchesFilters]);

  const visibleRows = viewMode === "separate" ? separateRows : mergedRows;

  const warehouseScopeLabel = useMemo(() => {
    if (warehouseScope === "all") return "Todos los almacenes";
    const warehouse = warehouses.find((item) => String(item.id) === String(warehouseScope));
    return warehouse?.name || `Almacen ${warehouseScope}`;
  }, [warehouseScope, warehouses]);

  const totals = useMemo(() => {
    return visibleRows.reduce(
      (acc, row) => {
        acc.onHand += asNumber(row.on_hand);
        acc.reserved += asNumber(row.reserved);
        acc.available += asNumber(row.available);
        if (asNumber(row.available) <= 10) acc.low += 1;
        return acc;
      },
      { onHand: 0, reserved: 0, available: 0, low: 0 }
    );
  }, [visibleRows]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setWarehouseScope("all");
  }

  async function applyMovement(event) {
    event.preventDefault();

    try {
      setIsSaving(true);
      const payload = {
        variantId: Number(form.variantId),
        warehouseId: Number(form.warehouseId),
        type: form.type,
        qty: Number(form.qty),
        note: form.note.trim() || null,
        actor: "inventory-ui-v2",
      };

      if (!payload.variantId) throw new Error("Selecciona variante");
      if (!payload.warehouseId) throw new Error("Selecciona almacen");
      if (!payload.qty || payload.qty <= 0) throw new Error("Cantidad invalida");

      await api(endpoints.inventoryMovements, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setForm((current) => ({ ...current, qty: "", note: "" }));
      await loadData();
      toast.success("Movimiento aplicado");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventario operativo"
        description="Control por almacen con filtros avanzados y vista combinada o separada"
        actions={
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </Button>
        }
      />

      <ProcessGuide
        title="Flujo diario de inventario"
        description="Sigue siempre este orden para evitar descuadres de stock."
        steps={[
          {
            title: "Seleccionar vista",
            detail: "Por almacen o almacenes juntos segun lo que necesites revisar.",
            tone: "info",
            tag: "vista",
          },
          {
            title: "Filtrar y detectar alertas",
            detail: "Busca por SKU/producto y revisa criticos o sin stock.",
            tone: "warning",
            tag: "alertas",
          },
          {
            title: "Aplicar movimiento",
            detail: "Entrada, salida o ajuste manual con nota de trazabilidad.",
            tone: "info",
            tag: "ledger",
          },
          {
            title: "Validar disponible",
            detail: "Confirma que el disponible final es coherente para preparar pedidos.",
            tone: "success",
            tag: "cierre",
          },
        ]}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Badge variant="outline">
            Vista: {viewMode === "separate" ? "Por almacen (separado)" : "Almacenes juntos"}
          </Badge>
          {viewMode === "separate" ? (
            <Badge variant="secondary">
              Ambito: {warehouseScopeLabel}
            </Badge>
          ) : null}
          <Badge variant={activeFiltersCount > 0 ? "warning" : "outline"}>
            Filtros activos: {activeFiltersCount}
          </Badge>
        </CardContent>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="On hand (vista actual)" value={totals.onHand} />
        <StatCard label="Reservado (vista actual)" value={totals.reserved} />
        <StatCard label="Disponible (vista actual)" value={totals.available} />
        <StatCard
          label="Registros criticos"
          value={totals.low}
          note="Disponible <= 10 segun filtros"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Movimiento manual</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={applyMovement} className="grid gap-3 lg:grid-cols-6">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="variant">Variante</Label>
              <NativeSelect
                id="variant"
                value={form.variantId}
                onChange={(event) => updateForm("variantId", event.target.value)}
              >
                <option value="">Selecciona</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} - {variant.product_name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="warehouse">Almacen</Label>
              <NativeSelect
                id="warehouse"
                value={form.warehouseId}
                onChange={(event) => updateForm("warehouseId", event.target.value)}
              >
                <option value="">Selecciona</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Tipo</Label>
              <NativeSelect
                id="type"
                value={form.type}
                onChange={(event) => updateForm("type", event.target.value)}
              >
                {MOVEMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qty">Cantidad</Label>
              <Input
                id="qty"
                type="number"
                min="1"
                value={form.qty}
                onChange={(event) => updateForm("qty", event.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Nota</Label>
              <Input
                id="note"
                value={form.note}
                onChange={(event) => updateForm("note", event.target.value)}
                placeholder="Opcional"
              />
            </div>

            <div className="lg:col-span-6">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" /> : <Send />}
                Aplicar movimiento
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balance avanzado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={viewMode} onValueChange={setViewMode}>
            <TabsList>
              <TabsTrigger value="separate">Por almacen (separado)</TabsTrigger>
              <TabsTrigger value="merged">Almacenes juntos</TabsTrigger>
            </TabsList>
          </Tabs>

          {viewMode === "separate" ? (
            <Tabs value={warehouseScope} onValueChange={setWarehouseScope}>
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="all">Todos los almacenes</TabsTrigger>
                {warehouses.map((warehouse) => (
                  <TabsTrigger key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Vista agrupada: suma stock de todos los almacenes por SKU.
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-12">
            <div className="space-y-2 lg:col-span-3">
              <Label htmlFor="filter-term">SKU o producto</Label>
              <Input
                id="filter-term"
                placeholder="Buscar"
                value={filters.term}
                onChange={(event) => updateFilter("term", event.target.value)}
              />
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="filter-pack">Pack</Label>
              <NativeSelect
                id="filter-pack"
                value={filters.pack}
                onChange={(event) => updateFilter("pack", event.target.value)}
              >
                <option value="all">Todos</option>
                {packOptions.map((pack) => (
                  <option key={pack} value={String(pack)}>
                    {pack}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="filter-stock">Estado stock</Label>
              <NativeSelect
                id="filter-stock"
                value={filters.stockStatus}
                onChange={(event) => updateFilter("stockStatus", event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="critical">Critico (&lt;=10)</option>
                <option value="healthy">Sano (&gt;10)</option>
                <option value="zero">Sin stock (=0)</option>
              </NativeSelect>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="filter-reserved">Reserva</Label>
              <NativeSelect
                id="filter-reserved"
                value={filters.reservedStatus}
                onChange={(event) => updateFilter("reservedStatus", event.target.value)}
              >
                <option value="all">Todas</option>
                <option value="with_reserved">Con reserva</option>
                <option value="without_reserved">Sin reserva</option>
              </NativeSelect>
            </div>

            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="filter-min">Min disp.</Label>
              <Input
                id="filter-min"
                type="number"
                value={filters.minAvailable}
                onChange={(event) => updateFilter("minAvailable", event.target.value)}
                placeholder="-"
              />
            </div>

            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="filter-max">Max disp.</Label>
              <Input
                id="filter-max"
                type="number"
                value={filters.maxAvailable}
                onChange={(event) => updateFilter("maxAvailable", event.target.value)}
                placeholder="-"
              />
            </div>

            <div className="space-y-2 lg:col-span-1">
              <Label className="opacity-0">Accion</Label>
              <Button type="button" variant="outline" onClick={resetFilters} className="w-full">
                <RotateCcw />
                Reset
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              {viewMode === "separate" ? (
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Almacen</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                </TableRow>
              ) : (
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Almacenes incluidos</TableHead>
                  <TableHead className="text-right">On hand total</TableHead>
                  <TableHead className="text-right">Reservado total</TableHead>
                  <TableHead className="text-right">Disponible total</TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Sin datos para los filtros actuales
                  </TableCell>
                </TableRow>
              ) : viewMode === "separate" ? (
                visibleRows.map((row) => {
                  const available = asNumber(row.available);
                  return (
                    <TableRow key={`${row.variant_id}-${row.warehouse_id}`}>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.pack_size}</TableCell>
                      <TableCell>{row.warehouse_name}</TableCell>
                      <TableCell className="text-right">{asNumber(row.on_hand)}</TableCell>
                      <TableCell className="text-right">{asNumber(row.reserved)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={available <= 10 ? "warning" : "success"} className="ml-auto">
                          {available}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                visibleRows.map((row) => {
                  const available = asNumber(row.available);
                  return (
                    <TableRow key={`merged-${row.variant_id}`}>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.pack_size}</TableCell>
                      <TableCell>{row.warehouses.join(", ")}</TableCell>
                      <TableCell className="text-right">{asNumber(row.on_hand)}</TableCell>
                      <TableCell className="text-right">{asNumber(row.reserved)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={available <= 10 ? "warning" : "success"} className="ml-auto">
                          {available}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
