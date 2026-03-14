import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronsUpDown, Play, RefreshCw, ScanLine, Wrench } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, endpoints } from "@/lib/api";
import { asNumber } from "@/lib/utils";

function pendingLines(order) {
  return (order?.lines || []).filter(
    (line) => asNumber(line.qty_picked) < asNumber(line.qty_ordered)
  );
}

function nextPendingLine(order) {
  return pendingLines(order)[0] || null;
}

function getProgress(order) {
  const lines = order?.lines || [];
  const total = lines.reduce((acc, line) => acc + asNumber(line.qty_ordered), 0);
  const picked = lines.reduce((acc, line) => acc + asNumber(line.qty_picked), 0);
  const pct = total === 0 ? 0 : Math.round((picked / total) * 100);
  return { total, picked, pct };
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function lineMatchesCode(line, code) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;

  const references = [line?.sku, line?.barcode, line?.qr_code]
    .map((item) => normalizeCode(item))
    .filter(Boolean);

  return references.includes(normalized);
}

function sourceBadge(source) {
  return String(source || "manual").toLowerCase() === "prestashop" ? (
    <Badge variant="secondary">Prestashop</Badge>
  ) : (
    <Badge variant="outline">Manual</Badge>
  );
}

function lineDisplayName(line) {
  const genetics = String(line?.product_strain || line?.product_name || "Producto").trim();
  const pack = asNumber(line?.pack_size);
  return pack > 0 ? `${genetics} - Pack ${pack}` : genetics;
}

export function PickingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState([]);
  const [variants, setVariants] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [queueSourceFilter, setQueueSourceFilter] = useState("all");
  const [scanSku, setScanSku] = useState("");
  const [strictSequence, setStrictSequence] = useState(true);
  const [activeToolTab, setActiveToolTab] = useState("scan");
  const [adjustLineId, setAdjustLineId] = useState("");
  const [adjustVariantId, setAdjustVariantId] = useState("");
  const [adjustQtyOrdered, setAdjustQtyOrdered] = useState("");
  const [isQueueLoading, setIsQueueLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isAdjustSaving, setIsAdjustSaving] = useState(false);

  const selectedOrderIdFromQuery = Number(searchParams.get("order") || 0);

  const loadQueue = useCallback(async () => {
    try {
      setIsQueueLoading(true);
      const query = new URLSearchParams({ source: queueSourceFilter });
      const data = await api(`${endpoints.ordersQueue}?${query.toString()}`);
      setQueue(data || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsQueueLoading(false);
    }
  }, [queueSourceFilter]);

  const loadVariants = useCallback(async () => {
    try {
      const data = await api(endpoints.variants);
      setVariants(data || []);
    } catch (error) {
      toast.error(error.message);
    }
  }, []);

  const openOrder = useCallback(
    async (orderId, options = {}) => {
      if (!orderId) return;

      try {
        const order = await api(`${endpoints.orders}/${orderId}`);
        setSelectedOrder(order);
        setSearchParams({ order: String(orderId) }, { replace: true });

        if (options.focusInput) {
          const input = document.getElementById("scanSkuInput");
          if (input) input.focus();
        }
      } catch (error) {
        toast.error(error.message);
      }
    },
    [setSearchParams]
  );

  useEffect(() => {
    loadQueue();
    loadVariants();
  }, [loadQueue, loadVariants]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadQueue();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    if (
      selectedOrderIdFromQuery &&
      asNumber(selectedOrder?.id) !== selectedOrderIdFromQuery
    ) {
      openOrder(selectedOrderIdFromQuery);
    }
  }, [openOrder, selectedOrder?.id, selectedOrderIdFromQuery]);

  useEffect(() => {
    if (!selectedOrder) {
      setAdjustLineId("");
      setAdjustVariantId("");
      setAdjustQtyOrdered("");
      return;
    }

    const preferredLine =
      (selectedOrder.lines || []).find((line) => String(line.id) === String(adjustLineId)) ||
      nextPendingLine(selectedOrder) ||
      selectedOrder.lines?.[0] ||
      null;

    if (!preferredLine) return;

    const preferredLineId = String(preferredLine.id);
    const preferredVariantId = String(preferredLine.variant_id);
    const preferredQty = String(preferredLine.qty_ordered);

    if (adjustLineId !== preferredLineId) setAdjustLineId(preferredLineId);
    if (adjustVariantId !== preferredVariantId) setAdjustVariantId(preferredVariantId);
    if (adjustQtyOrdered !== preferredQty) setAdjustQtyOrdered(preferredQty);
  }, [adjustLineId, selectedOrder]);

  const progress = useMemo(() => getProgress(selectedOrder), [selectedOrder]);
  const nextLine = useMemo(() => nextPendingLine(selectedOrder), [selectedOrder]);
  const activeAdjustLine = useMemo(() => {
    if (!selectedOrder || !adjustLineId) return null;
    return selectedOrder.lines?.find((line) => String(line.id) === String(adjustLineId)) || null;
  }, [adjustLineId, selectedOrder]);

  const adjustHasChanges =
    activeAdjustLine &&
    (Number(adjustVariantId) !== Number(activeAdjustLine.variant_id) ||
      Number(adjustQtyOrdered) !== Number(activeAdjustLine.qty_ordered));

  function selectLineForAdjustment(line, options = {}) {
    if (!line) return;
    setAdjustLineId(String(line.id));
    setAdjustVariantId(String(line.variant_id));
    setAdjustQtyOrdered(String(line.qty_ordered));
    if (options.openTab !== false) {
      setActiveToolTab("adjust");
    }
  }

  async function startPicking() {
    if (!selectedOrder) return;

    try {
      setIsActionLoading(true);
      await api(`${endpoints.orders}/${selectedOrder.id}/start`, { method: "POST" });
      await openOrder(selectedOrder.id, { focusInput: true });
      await loadQueue();
      toast.success("Picking iniciado");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsActionLoading(false);
    }
  }

  async function executeScan(customSku, customQty) {
    if (!selectedOrder) return;

    try {
      setIsActionLoading(true);
      const sku = normalizeCode(customSku || scanSku);
      const qty = Number(customQty || 1);

      if (!sku) throw new Error("Escanea o escribe un SKU");
      if (!qty || qty <= 0) throw new Error("Cantidad invalida");

      if (strictSequence && nextLine && !lineMatchesCode(nextLine, sku)) {
        throw new Error(`Escaneo fuera de secuencia. Esperado: ${nextLine.sku}`);
      }

      await api(endpoints.pickingScan, {
        method: "POST",
        body: JSON.stringify({ orderId: selectedOrder.id, sku, qty }),
      });

      setScanSku("");
      await openOrder(selectedOrder.id, { focusInput: true });
      await loadQueue();
      toast.success(`Escaneo correcto: ${sku} x${qty}`);
    } catch (error) {
      const expected = nextPendingLine(selectedOrder);
      if (expected && strictSequence) {
        toast.error(`${error.message}. Esperado: ${expected.sku}`);
      } else {
        toast.error(error.message);
      }
    } finally {
      setIsActionLoading(false);
    }
  }

  async function quickScanLine(line, mode) {
    if (!line) return;
    const pending = asNumber(line.qty_ordered) - asNumber(line.qty_picked);
    if (pending <= 0) return;

    const qty = mode === "full" ? pending : 1;
    await executeScan(line.sku, qty);
  }

  async function completeOrder() {
    if (!selectedOrder) return;

    try {
      setIsActionLoading(true);
      await api(`/api/picking/complete/${selectedOrder.id}`, { method: "POST" });
      toast.success(`Pedido #${selectedOrder.id} completado`);
      setSelectedOrder(null);
      setScanSku("");
      setSearchParams({}, { replace: true });
      await loadQueue();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsActionLoading(false);
    }
  }

  async function applyManualAdjustment(event) {
    event.preventDefault();
    if (!selectedOrder || !activeAdjustLine) return;

    try {
      setIsAdjustSaving(true);

      const variantId = Number(adjustVariantId);
      const qtyOrdered = Number(adjustQtyOrdered);
      if (!variantId || !Number.isInteger(variantId)) throw new Error("Selecciona variante");
      if (!qtyOrdered || !Number.isInteger(qtyOrdered)) throw new Error("Cantidad invalida");

      if (asNumber(activeAdjustLine.qty_picked) > 0 && variantId !== asNumber(activeAdjustLine.variant_id)) {
        throw new Error("No puedes cambiar variante de una linea ya empezada");
      }

      await api(`/api/orders/${selectedOrder.id}/lines/${activeAdjustLine.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          variantId,
          qtyOrdered,
          actor: "picking-ui",
        }),
      });

      await openOrder(selectedOrder.id, { focusInput: false });
      await loadQueue();
      setActiveToolTab("scan");
      toast.success("Ajuste aplicado y reserva recalculada");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsAdjustSaving(false);
    }
  }

  const isAllDone = selectedOrder ? pendingLines(selectedOrder).length === 0 : false;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Picking guiado"
        description="Escaneo con verificacion, checklist por linea y ajustes manuales con impacto en stock"
        actions={
          <Button variant="outline" onClick={loadQueue} disabled={isQueueLoading}>
            <RefreshCw className={isQueueLoading ? "animate-spin" : ""} />
            Refrescar cola
          </Button>
        }
      />

      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Pedidos para preparar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="picking-source-filter" className="text-sm font-medium">
                Origen
              </label>
              <NativeSelect
                id="picking-source-filter"
                value={queueSourceFilter}
                onChange={(event) => setQueueSourceFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="manual">Solo manuales</option>
                <option value="prestashop">Solo PrestaShop</option>
              </NativeSelect>
            </div>

            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42%]">Pedido</TableHead>
                  <TableHead className="w-[17%]">Origen</TableHead>
                  <TableHead className="w-[17%]">Estado</TableHead>
                  <TableHead className="w-[12%]">Prog.</TableHead>
                  <TableHead className="w-[12%] text-right">Abrir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Sin pedidos pendientes
                    </TableCell>
                  </TableRow>
                ) : (
                  queue.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="max-w-[180px]">
                        <p className="font-medium">#{order.id}</p>
                        <p className="truncate text-xs text-muted-foreground">{order.warehouse_name || "-"}</p>
                        {order.external_id ? (
                          <p className="truncate text-xs text-muted-foreground" title={order.external_id}>
                            {order.external_id}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{sourceBadge(order.source)}</TableCell>
                      <TableCell>
                        <StatusPill status={order.status} />
                      </TableCell>
                      <TableCell>
                        {asNumber(order.picked_qty)}/{asNumber(order.total_qty)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openOrder(order.id, { focusInput: true })}
                        >
                          Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Estacion de picking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedOrder ? (
              <p className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                1) Selecciona pedido. 2) Inicia picking. 3) Escanea o usa los atajos por linea.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-semibold">Pedido #{selectedOrder.id}</p>
                    <StatusPill status={selectedOrder.status} />
                    {sourceBadge(selectedOrder.source)}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Almacen: {selectedOrder.warehouse_name || "-"}
                  </p>
                  {selectedOrder.external_id ? (
                    <p className="text-xs text-muted-foreground">Origen externo: {selectedOrder.external_id}</p>
                  ) : null}
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/80">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-all"
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Progreso {progress.picked}/{progress.total} ({progress.pct}%)
                  </p>
                </div>

                <Tabs value={activeToolTab} onValueChange={setActiveToolTab}>
                  <TabsList>
                    <TabsTrigger value="scan">Escaneo</TabsTrigger>
                    <TabsTrigger value="adjust">Ajustes manuales</TabsTrigger>
                  </TabsList>

                  <TabsContent value="scan" className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                        Siguiente articulo esperado
                      </p>
                      {nextLine ? (
                        <div className="mt-2 flex items-center gap-4">
                          {nextLine.product_image ? (
                            <img
                              src={nextLine.product_image}
                              alt={nextLine.product_name}
                              className="h-20 w-20 rounded-xl object-cover ring-1 ring-border/60"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-20 w-20 rounded-xl border border-dashed border-border/70" />
                          )}
                          <div>
                            <p className="font-display text-3xl font-bold">{lineDisplayName(nextLine)}</p>
                            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                              SKU: {nextLine.sku}
                            </p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              Pendiente{" "}
                              {asNumber(nextLine.qty_ordered) - asNumber(nextLine.qty_picked)} ud
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 font-display text-4xl font-bold">TODO LISTO</p>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-7">
                      <div className="space-y-2 md:col-span-5">
                        <label htmlFor="scanSkuInput" className="text-sm font-medium">
                          Escaneo SKU / barcode / QR
                        </label>
                        <Input
                          id="scanSkuInput"
                          value={scanSku}
                          onChange={(event) => setScanSku(normalizeCode(event.target.value))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              executeScan(undefined, 1);
                            }
                          }}
                          className="h-12 text-lg"
                          placeholder="Escanea aqui"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <p className="mb-2 text-sm font-medium">Modo</p>
                        <div className="space-y-1 rounded-md border border-border/60 p-2 text-sm">
                          <label className="flex items-center gap-2 text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={strictSequence}
                              onChange={(event) => setStrictSequence(event.target.checked)}
                              className="h-4 w-4 rounded border-border bg-background"
                            />
                            Solo siguiente SKU
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Escaner = 1 unidad por lectura.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={startPicking}
                        disabled={!selectedOrder || selectedOrder.status !== "pending" || isActionLoading}
                      >
                        <Play />
                        Iniciar
                      </Button>
                      <Button onClick={() => executeScan(undefined, 1)} disabled={!selectedOrder || isActionLoading}>
                        <ScanLine />
                        Escanear 1 ud
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => quickScanLine(nextLine, "one")}
                        disabled={!nextLine || isActionLoading}
                      >
                        <ChevronsUpDown />
                        +1 esperado
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => quickScanLine(nextLine, "full")}
                        disabled={!nextLine || isActionLoading}
                      >
                        <Check />
                        Completar esperado
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={completeOrder}
                        disabled={!selectedOrder || !isAllDone || isActionLoading}
                      >
                        Cerrar pedido
                      </Button>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Check</TableHead>
                          <TableHead>Articulo</TableHead>
                          <TableHead>Hecho</TableHead>
                          <TableHead>Pendiente</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedOrder.lines || []).map((line) => {
                          const pending = asNumber(line.qty_ordered) - asNumber(line.qty_picked);
                          const done = pending === 0;
                          const isExpected = asNumber(nextLine?.id) === asNumber(line.id);

                          return (
                            <TableRow
                              key={line.id}
                              className={
                                isExpected
                                  ? "bg-cyan-500/10"
                                  : done
                                  ? "bg-emerald-500/5"
                                  : "bg-amber-500/5"
                              }
                            >
                              <TableCell>
                                <Badge variant={done ? "success" : "warning"}>
                                  {done ? "OK" : "Pendiente"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  {line.product_image ? (
                                    <img
                                      src={line.product_image}
                                      alt={line.product_name}
                                      className="h-12 w-12 rounded-md object-cover ring-1 ring-border/60"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="h-12 w-12 rounded-md border border-dashed border-border/70" />
                                  )}
                                  <div>
                                    <p className="font-medium">{lineDisplayName(line)}</p>
                                    <p className="text-xs text-muted-foreground">SKU: {line.sku}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                {asNumber(line.qty_picked)}/{asNumber(line.qty_ordered)}
                              </TableCell>
                              <TableCell>{pending}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => quickScanLine(line, "one")}
                                    disabled={done || isActionLoading || (strictSequence && !isExpected)}
                                  >
                                    +1
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => quickScanLine(line, "full")}
                                    disabled={done || isActionLoading || (strictSequence && !isExpected)}
                                  >
                                    Completar
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => selectLineForAdjustment(line)}
                                    disabled={isActionLoading || isAdjustSaving}
                                  >
                                    <Wrench className="h-4 w-4" />
                                    Ajustar
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="adjust" className="space-y-4">
                    {!activeAdjustLine ? (
                      <p className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                        Selecciona una linea desde la tabla para ajustar variante o cantidad.
                      </p>
                    ) : (
                      <form onSubmit={applyManualAdjustment} className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <label htmlFor="adjust-line" className="text-sm font-medium">
                              Linea del pedido
                            </label>
                            <NativeSelect
                              id="adjust-line"
                              value={adjustLineId}
                              onChange={(event) => {
                                const lineId = event.target.value;
                                setAdjustLineId(lineId);
                                const line = selectedOrder.lines?.find(
                                  (entry) => String(entry.id) === String(lineId)
                                );
                                if (line) {
                                  setAdjustVariantId(String(line.variant_id));
                                  setAdjustQtyOrdered(String(line.qty_ordered));
                                }
                              }}
                            >
                              {(selectedOrder.lines || []).map((line) => (
                                <option key={line.id} value={line.id}>
                                  #{line.id} - {line.sku} ({line.qty_picked}/{line.qty_ordered})
                                </option>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="space-y-2">
                            <label htmlFor="adjust-variant" className="text-sm font-medium">
                              Variante
                            </label>
                            <NativeSelect
                              id="adjust-variant"
                              value={adjustVariantId}
                              onChange={(event) => setAdjustVariantId(event.target.value)}
                              disabled={asNumber(activeAdjustLine.qty_picked) > 0}
                            >
                              {variants.map((variant) => (
                                <option key={variant.id} value={variant.id}>
                                  {variant.sku} - {variant.product_name} ({variant.pack_size})
                                </option>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="space-y-2">
                            <label htmlFor="adjust-qty" className="text-sm font-medium">
                              Cantidad pedida
                            </label>
                            <Input
                              id="adjust-qty"
                              type="number"
                              min={Math.max(1, asNumber(activeAdjustLine.qty_picked))}
                              value={adjustQtyOrdered}
                              onChange={(event) => setAdjustQtyOrdered(event.target.value)}
                            />
                          </div>
                        </div>

                        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                          <p>
                            Escaneado:{" "}
                            <span className="font-semibold text-foreground">
                              {asNumber(activeAdjustLine.qty_picked)}
                            </span>
                          </p>
                          <p>
                            Reservado actual:{" "}
                            <span className="font-semibold text-foreground">
                              {asNumber(activeAdjustLine.qty_reserved)}
                            </span>
                          </p>
                          {asNumber(activeAdjustLine.qty_picked) > 0 ? (
                            <p className="mt-1 text-amber-300">
                              Esta linea ya tiene unidades escaneadas, por seguridad no se permite cambiar variante.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="submit"
                            disabled={!adjustHasChanges || isAdjustSaving || isActionLoading}
                          >
                            {isAdjustSaving ? <RefreshCw className="animate-spin" /> : <Wrench />}
                            Guardar ajuste
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => selectLineForAdjustment(activeAdjustLine, { openTab: false })}
                            disabled={isAdjustSaving}
                          >
                            Revertir cambios
                          </Button>
                        </div>
                      </form>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
