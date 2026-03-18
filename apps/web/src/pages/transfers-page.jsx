import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { ProcessGuide } from "@/components/process-guide";
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
import { Textarea } from "@/components/ui/textarea";
import { api, endpoints } from "@/lib/api";
import { asNumber, formatDateTime } from "@/lib/utils";

export function TransfersPage() {
  const [variants, setVariants] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    variantId: "",
    fromWarehouseId: "",
    toWarehouseId: "",
    qty: "",
    note: "",
  });

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [variantsResponse, warehousesResponse, transfersResponse, inventoryResponse] =
        await Promise.all([
          api(endpoints.variants),
          api(endpoints.warehouses),
          api(endpoints.transfers),
          api(endpoints.inventoryBalance),
        ]);

      setVariants(variantsResponse || []);
      setWarehouses(warehousesResponse || []);
      setTransfers(transfersResponse || []);
      setInventoryRows(inventoryResponse || []);

      setForm((current) => {
        const from = current.fromWarehouseId || String(warehousesResponse?.[0]?.id || "");
        const to =
          current.toWarehouseId ||
          String(warehousesResponse?.[1]?.id || warehousesResponse?.[0]?.id || "");

        return {
          ...current,
          variantId: current.variantId || String(variantsResponse?.[0]?.id || ""),
          fromWarehouseId: from,
          toWarehouseId: to,
        };
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stockSummary = useMemo(() => {
    return inventoryRows
      .slice()
      .sort((a, b) => String(a.sku).localeCompare(String(b.sku), "es", { sensitivity: "base" }))
      .slice(0, 40);
  }, [inventoryRows]);

  const selectedVariant = useMemo(
    () => variants.find((variant) => Number(variant.id) === Number(form.variantId)) || null,
    [form.variantId, variants]
  );

  const selectedVariantStocks = useMemo(() => {
    if (!form.variantId) return [];

    return inventoryRows
      .filter((row) => Number(row.variant_id) === Number(form.variantId))
      .sort((a, b) =>
        String(a.warehouse_name).localeCompare(String(b.warehouse_name), "es", {
          sensitivity: "base",
        })
      );
  }, [form.variantId, inventoryRows]);

  const fromAvailable = useMemo(() => {
    const row = selectedVariantStocks.find(
      (entry) => Number(entry.warehouse_id) === Number(form.fromWarehouseId)
    );
    return asNumber(row?.available);
  }, [form.fromWarehouseId, selectedVariantStocks]);

  const toAvailable = useMemo(() => {
    const row = selectedVariantStocks.find(
      (entry) => Number(entry.warehouse_id) === Number(form.toWarehouseId)
    );
    return asNumber(row?.available);
  }, [form.toWarehouseId, selectedVariantStocks]);

  const requestedQty = useMemo(() => asNumber(form.qty), [form.qty]);
  const exceedsOriginStock = requestedQty > 0 && requestedQty > fromAvailable;

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createTransfer(event) {
    event.preventDefault();

    try {
      setIsSaving(true);
      const payload = {
        variantId: Number(form.variantId),
        fromWarehouseId: Number(form.fromWarehouseId),
        toWarehouseId: Number(form.toWarehouseId),
        qty: Number(form.qty),
        note: form.note.trim() || null,
        actor: "transfer-ui-v2",
      };

      if (!payload.variantId) throw new Error("Selecciona variante");
      if (!payload.fromWarehouseId || !payload.toWarehouseId) {
        throw new Error("Selecciona origen y destino");
      }
      if (payload.fromWarehouseId === payload.toWarehouseId) {
        throw new Error("Origen y destino deben ser distintos");
      }
      if (!payload.qty || payload.qty <= 0) {
        throw new Error("Cantidad invalida");
      }

      await api(endpoints.transfers, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setForm((current) => ({ ...current, qty: "", note: "" }));
      await loadData();
      toast.success("Traspaso ejecutado");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Traspasos entre almacenes"
        description="Movimiento doble controlado para recolocar stock sin descuadrar reservas"
        actions={
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </Button>
        }
      />

      <ProcessGuide
        title="Flujo seguro de traspaso"
        description="Si sigues estos pasos evitaras faltas de stock durante la preparacion."
        steps={[
          {
            title: "Elegir SKU y almacenes",
            detail: "Selecciona origen y destino distintos.",
            tone: "info",
            tag: "origen/destino",
          },
          {
            title: "Validar disponible",
            detail: "No muevas mas unidades que el disponible real en origen.",
            tone: "warning",
            tag: "control",
          },
          {
            title: "Ejecutar traspaso",
            detail: "Se descuenta en origen y entra en destino automaticamente.",
            tone: "info",
            tag: "ledger",
          },
          {
            title: "Confirmar historico",
            detail: "Revisa el registro para trazabilidad.",
            tone: "success",
            tag: "auditoria",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Nuevo traspaso guiado</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createTransfer} className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-8">
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

              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="fromWarehouse">Origen</Label>
                <NativeSelect
                  id="fromWarehouse"
                  value={form.fromWarehouseId}
                  onChange={(event) => updateForm("fromWarehouseId", event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="toWarehouse">Destino</Label>
                <NativeSelect
                  id="toWarehouse"
                  value={form.toWarehouseId}
                  onChange={(event) => updateForm("toWarehouseId", event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-2 lg:col-span-1">
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

              <div className="space-y-2 lg:col-span-8">
                <Label htmlFor="note">Nota</Label>
                <Textarea
                  id="note"
                  value={form.note}
                  onChange={(event) => updateForm("note", event.target.value)}
                  placeholder="Motivo del traspaso"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Variante</p>
                <p className="mt-1 font-medium">{selectedVariant?.sku || "-"}</p>
                <p className="text-xs text-muted-foreground">{selectedVariant?.product_name || "-"}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Disponible origen</p>
                <p className="mt-1 text-2xl font-semibold">{fromAvailable}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Disponible destino</p>
                <p className="mt-1 text-2xl font-semibold">{toAvailable}</p>
              </div>
            </div>

            {exceedsOriginStock ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <TriangleAlert className="h-4 w-4" />
                La cantidad supera el disponible en origen.
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSaving || exceedsOriginStock}>
                {isSaving ? <RefreshCw className="animate-spin" /> : <ArrowRightLeft />}
                Ejecutar traspaso
              </Button>
              {requestedQty > 0 ? (
                <Badge variant="outline">Movimiento solicitado: {requestedQty} ud</Badge>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Historico de traspasos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Cant.</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Sin traspasos
                    </TableCell>
                  </TableRow>
                ) : (
                  transfers.slice(0, 40).map((transfer) => (
                    <TableRow key={transfer.id}>
                      <TableCell>#{transfer.id}</TableCell>
                      <TableCell className="font-medium">{transfer.sku}</TableCell>
                      <TableCell>{asNumber(transfer.qty)}</TableCell>
                      <TableCell>{transfer.from_warehouse_name}</TableCell>
                      <TableCell>{transfer.to_warehouse_name}</TableCell>
                      <TableCell>{formatDateTime(transfer.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock actual (resumen)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Almacen</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockSummary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Sin datos
                    </TableCell>
                  </TableRow>
                ) : (
                  stockSummary.map((row) => (
                    <TableRow key={`${row.variant_id}-${row.warehouse_id}`}>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell>{row.warehouse_name}</TableCell>
                      <TableCell className="text-right">{asNumber(row.available)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
