
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  Eye,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { ProcessGuide } from "@/components/process-guide";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, endpoints } from "@/lib/api";
import { asNumber, formatDateTime } from "@/lib/utils";

const DEFAULT_PRESTASHOP_SETTINGS = {
  baseUrl: "",
  apiKey: "",
  defaultWarehouseId: "",
  orderStateFilter: "",
  pullLimit: "25",
  timeoutMs: "12000",
};

function formatMoney(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function sourceBadge(source) {
  const normalized = String(source || "manual").toLowerCase();
  if (normalized === "prestashop") return <Badge variant="secondary">Prestashop</Badge>;
  return <Badge variant="outline">Manual</Badge>;
}

export function OrdersPage() {
  const [activeTab, setActiveTab] = useState("internal");

  const [variants, setVariants] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [queue, setQueue] = useState([]);
  const [draftLines, setDraftLines] = useState([]);

  const [isQueueLoading, setIsQueueLoading] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [queueSourceFilter, setQueueSourceFilter] = useState("all");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [lineQty, setLineQty] = useState("1");

  const [prestashopOrders, setPrestashopOrders] = useState([]);
  const [prestashopMeta, setPrestashopMeta] = useState({
    count: 0,
    pulledAt: null,
    requestUrl: "",
  });
  const [isPrestashopLoading, setIsPrestashopLoading] = useState(false);

  const [prestashopWarehouseId, setPrestashopWarehouseId] = useState("");
  const [selectedPrestashopOrderId, setSelectedPrestashopOrderId] = useState(null);
  const [prestashopPreview, setPrestashopPreview] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImportingPrestashop, setIsImportingPrestashop] = useState(false);

  const [prestashopSettings, setPrestashopSettings] = useState(DEFAULT_PRESTASHOP_SETTINGS);
  const [prestashopSettingsMeta, setPrestashopSettingsMeta] = useState({
    hasApiKey: false,
    apiKeyMasked: null,
    updatedAt: null,
  });
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [isConnectionTesting, setIsConnectionTesting] = useState(false);
  const [connectionPreview, setConnectionPreview] = useState([]);
  const [connectionRequestUrl, setConnectionRequestUrl] = useState("");

  const loadBase = useCallback(async () => {
    try {
      const [variantsResponse, warehousesResponse] = await Promise.all([
        api(endpoints.variants),
        api(endpoints.warehouses),
      ]);

      setVariants(variantsResponse || []);
      setWarehouses(warehousesResponse || []);

      if (!selectedVariantId && variantsResponse?.[0]) {
        setSelectedVariantId(String(variantsResponse[0].id));
      }
      if (!selectedWarehouseId && warehousesResponse?.[0]) {
        setSelectedWarehouseId(String(warehousesResponse[0].id));
      }
      if (!prestashopWarehouseId && warehousesResponse?.[0]) {
        setPrestashopWarehouseId(String(warehousesResponse[0].id));
      }
    } catch (error) {
      toast.error(error.message);
    }
  }, [selectedVariantId, selectedWarehouseId, prestashopWarehouseId]);

  const loadQueue = useCallback(async () => {
    try {
      setIsQueueLoading(true);
      const query = new URLSearchParams({
        includeCompleted: includeCompleted ? "true" : "false",
        source: queueSourceFilter,
      });
      const response = await api(`${endpoints.ordersQueue}?${query.toString()}`);
      setQueue(response || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsQueueLoading(false);
    }
  }, [includeCompleted, queueSourceFilter]);

  const loadPrestashopSettings = useCallback(async () => {
    try {
      setIsSettingsLoading(true);
      const response = await api(endpoints.prestashopSettings);
      const settings = response?.settings || {};

      setPrestashopSettings((current) => ({
        ...current,
        baseUrl: settings.baseUrl || "",
        orderStateFilter: settings.orderStateFilter || "",
        pullLimit: String(settings.pullLimit || 25),
        timeoutMs: String(settings.timeoutMs || 12000),
        defaultWarehouseId: settings.defaultWarehouseId
          ? String(settings.defaultWarehouseId)
          : current.defaultWarehouseId,
        apiKey: "",
      }));

      setPrestashopSettingsMeta({
        hasApiKey: Boolean(settings.hasApiKey),
        apiKeyMasked: settings.apiKeyMasked || null,
        updatedAt: settings.updatedAt || null,
      });

      if (settings.defaultWarehouseId) {
        setPrestashopWarehouseId(String(settings.defaultWarehouseId));
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSettingsLoading(false);
    }
  }, []);

  const loadPrestashopOrders = useCallback(async () => {
    try {
      setIsPrestashopLoading(true);
      const response = await api(endpoints.prestashopOrders);

      setPrestashopOrders(response?.orders || []);
      setPrestashopMeta({
        count: asNumber(response?.count),
        pulledAt: response?.pulledAt || null,
        requestUrl: response?.requestUrl || "",
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsPrestashopLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBase();
    loadPrestashopSettings();
  }, [loadBase, loadPrestashopSettings]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadQueue();
    }, 10000);

    return () => clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    if (activeTab === "prestashop" && prestashopOrders.length === 0) {
      loadPrestashopOrders();
    }
  }, [activeTab, loadPrestashopOrders, prestashopOrders.length]);

  const selectedVariant = useMemo(
    () => variants.find((variant) => Number(variant.id) === Number(selectedVariantId)),
    [selectedVariantId, variants]
  );

  function updatePrestashopSettings(field, value) {
    setPrestashopSettings((current) => ({ ...current, [field]: value }));
  }
  function addDraftLine() {
    try {
      const qty = Number(lineQty);
      if (!selectedVariantId) throw new Error("Selecciona variante");
      if (!qty || qty <= 0) throw new Error("Cantidad invalida");

      const variant = variants.find((item) => Number(item.id) === Number(selectedVariantId));
      if (!variant) throw new Error("Variante no encontrada");

      setDraftLines((current) => [
        ...current,
        {
          variantId: Number(variant.id),
          qty,
          sku: variant.sku,
          label: variant.product_name,
        },
      ]);

      setLineQty("1");
    } catch (error) {
      toast.error(error.message);
    }
  }

  function removeDraftLine(index) {
    setDraftLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  async function createOrder() {
    try {
      if (!selectedWarehouseId) throw new Error("Selecciona almacen");
      if (draftLines.length === 0) throw new Error("Agrega al menos una linea");

      setIsOrderSaving(true);
      const response = await api(endpoints.orders, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: Number(selectedWarehouseId),
          lines: draftLines.map((line) => ({
            variantId: line.variantId,
            qty: line.qty,
          })),
        }),
      });

      setDraftLines([]);
      await loadQueue();
      toast.success(`Pedido #${response.orderId} creado`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsOrderSaving(false);
    }
  }

  async function previewPrestashopOrder(orderId) {
    try {
      setIsPreviewLoading(true);
      setSelectedPrestashopOrderId(orderId);

      const query = prestashopWarehouseId ? `?warehouseId=${prestashopWarehouseId}` : "";
      const response = await api(`${endpoints.prestashopOrders}/${orderId}/preview${query}`);
      setPrestashopPreview(response || null);
      toast.success("Previsualizacion cargada");
    } catch (error) {
      toast.error(error.message);
      setPrestashopPreview(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function importPrestashopOrder(orderId) {
    try {
      setIsImportingPrestashop(true);

      const payload = {};
      if (prestashopWarehouseId) {
        payload.warehouseId = Number(prestashopWarehouseId);
      }

      const response = await api(`${endpoints.prestashopOrders}/${orderId}/import`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (response?.alreadyImported) {
        toast.success(`Pedido ya importado como #${response.orderId}`);
      } else {
        toast.success(`Pedido importado y reservado como #${response.orderId}`);
      }

      await Promise.all([loadQueue(), loadPrestashopOrders()]);
      await previewPrestashopOrder(orderId);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsImportingPrestashop(false);
    }
  }

  async function savePrestashopSettings() {
    try {
      setIsSettingsSaving(true);

      const payload = {
        baseUrl: prestashopSettings.baseUrl,
        orderStateFilter: prestashopSettings.orderStateFilter,
        pullLimit: Number(prestashopSettings.pullLimit),
        timeoutMs: Number(prestashopSettings.timeoutMs),
        defaultWarehouseId: prestashopSettings.defaultWarehouseId
          ? Number(prestashopSettings.defaultWarehouseId)
          : null,
      };

      if (prestashopSettings.apiKey.trim()) {
        payload.apiKey = prestashopSettings.apiKey.trim();
      }

      const response = await api(endpoints.prestashopSettings, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      const updated = response?.settings || {};
      setPrestashopSettings((current) => ({
        ...current,
        apiKey: "",
        baseUrl: updated.baseUrl || current.baseUrl,
        orderStateFilter: updated.orderStateFilter || "",
        pullLimit: String(updated.pullLimit || 25),
        timeoutMs: String(updated.timeoutMs || 12000),
        defaultWarehouseId: updated.defaultWarehouseId
          ? String(updated.defaultWarehouseId)
          : "",
      }));

      setPrestashopSettingsMeta({
        hasApiKey: Boolean(updated.hasApiKey),
        apiKeyMasked: updated.apiKeyMasked || null,
        updatedAt: updated.updatedAt || null,
      });

      if (updated.defaultWarehouseId) {
        setPrestashopWarehouseId(String(updated.defaultWarehouseId));
      }

      toast.success("Ajustes de PrestaShop guardados");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSettingsSaving(false);
    }
  }

  async function testPrestashopConnection() {
    try {
      setIsConnectionTesting(true);
      setConnectionPreview([]);
      setConnectionRequestUrl("");

      const payload = {
        baseUrl: prestashopSettings.baseUrl,
        orderStateFilter: prestashopSettings.orderStateFilter,
        pullLimit: Number(prestashopSettings.pullLimit),
        timeoutMs: Number(prestashopSettings.timeoutMs),
      };

      if (prestashopSettings.apiKey.trim()) {
        payload.apiKey = prestashopSettings.apiKey.trim();
      }

      const response = await api(endpoints.prestashopTest, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setConnectionPreview(response?.preview || []);
      setConnectionRequestUrl(response?.requestUrl || "");
      toast.success(`Conexion OK. Pedidos detectados: ${asNumber(response?.count)}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsConnectionTesting(false);
    }
  }

  const previewData = prestashopPreview?.preview || null;
  const previewCanImport =
    previewData &&
    previewData.unmappedLines?.length === 0 &&
    previewData.mappedLines?.length > 0 &&
    !previewData.mappedLines.some((line) => !line.enoughStock);

  const queueStats = useMemo(() => {
    return (queue || []).reduce(
      (acc, order) => {
        const source = String(order.source || "manual").toLowerCase();
        const status = String(order.status || "").toLowerCase();

        if (source === "prestashop") {
          acc.prestashop += 1;
        } else {
          acc.manual += 1;
        }

        if (status === "picking") acc.picking += 1;
        if (status === "pending") acc.pending += 1;

        return acc;
      },
      { manual: 0, prestashop: 0, pending: 0, picking: 0 }
    );
  }, [queue]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pedidos y reservas"
        description="Entrada de pedidos, reserva automatica y paso directo a picking"
        actions={
          activeTab === "internal" ? (
            <Button variant="outline" onClick={loadQueue} disabled={isQueueLoading}>
              <RefreshCw className={isQueueLoading ? "animate-spin" : ""} />
              Actualizar cola
            </Button>
          ) : activeTab === "prestashop" ? (
            <Button variant="outline" onClick={loadPrestashopOrders} disabled={isPrestashopLoading}>
              <RefreshCw className={isPrestashopLoading ? "animate-spin" : ""} />
              Actualizar PrestaShop
            </Button>
          ) : (
            <Button variant="outline" onClick={loadPrestashopSettings} disabled={isSettingsLoading}>
              <RefreshCw className={isSettingsLoading ? "animate-spin" : ""} />
              Recargar ajustes
            </Button>
          )
        }
      />

      <ProcessGuide
        title="Proceso de pedidos para operativa diaria"
        description="Tanto si el pedido es manual como de PrestaShop, el flujo es el mismo."
        steps={[
          {
            title: "Entrar pedido",
            detail: "Manual o sincronizado desde PrestaShop.",
            tone: "info",
            tag: "entrada",
          },
          {
            title: "Reservar stock",
            detail: "La reserva evita vender unidades ya comprometidas.",
            tone: "warning",
            tag: "reserva",
          },
          {
            title: "Enviar a cola",
            detail: "El pedido pasa automaticamente a preparacion/picking.",
            tone: "info",
            tag: "cola",
          },
          {
            title: "Abrir en picking",
            detail: "Preparar, escanear y cerrar pedido cuando todo este comprobado.",
            tone: "success",
            tag: "expedicion",
          },
        ]}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="En cola" value={queue.length} note="Pedidos pendientes + en curso" />
        <StatCard label="Pendientes" value={queueStats.pending} note="Listos para empezar picking" />
        <StatCard label="En picking" value={queueStats.picking} note="Preparacion activa" />
        <StatCard
          label="Origen PrestaShop"
          value={queueStats.prestashop}
          note={`Manuales: ${queueStats.manual}`}
        />
      </section>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            La cola se refresca automaticamente cada 10 segundos y los pedidos de PrestaShop se
            importan en segundo plano cuando la conexion esta configurada.
          </p>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="internal">Pedido manual + cola</TabsTrigger>
          <TabsTrigger value="prestashop">Entrada PrestaShop</TabsTrigger>
          <TabsTrigger value="settings">Ajustes de conexion</TabsTrigger>
        </TabsList>
        <TabsContent value="internal" className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Nuevo pedido manual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="warehouse">Almacen destino</Label>
                  <NativeSelect
                    id="warehouse"
                    value={selectedWarehouseId}
                    onChange={(event) => setSelectedWarehouseId(event.target.value)}
                  >
                    <option value="">Selecciona</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="grid gap-3 md:grid-cols-6">
                  <div className="space-y-2 md:col-span-4">
                    <Label htmlFor="variant">Variante</Label>
                    <NativeSelect
                      id="variant"
                      value={selectedVariantId}
                      onChange={(event) => setSelectedVariantId(event.target.value)}
                    >
                      <option value="">Selecciona</option>
                      {variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.sku} - {variant.product_name} ({variant.pack_size})
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="qty">Cantidad</Label>
                    <Input
                      id="qty"
                      type="number"
                      min="1"
                      value={lineQty}
                      onChange={(event) => setLineQty(event.target.value)}
                    />
                  </div>
                </div>

                {selectedVariant ? (
                  <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Seleccion: <span className="font-semibold text-foreground">{selectedVariant.sku}</span>
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={addDraftLine}>
                    <Plus />
                    Anadir linea
                  </Button>
                  <Button type="button" onClick={createOrder} disabled={isOrderSaving}>
                    {isOrderSaving ? <RefreshCw className="animate-spin" /> : null}
                    Crear pedido
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead className="text-right">Accion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftLines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          Sin lineas en borrador
                        </TableCell>
                      </TableRow>
                    ) : (
                      draftLines.map((line, index) => (
                        <TableRow key={`${line.variantId}-${index}`}>
                          <TableCell>
                            <p className="font-medium">{line.sku}</p>
                            <p className="text-xs text-muted-foreground">{line.label}</p>
                          </TableCell>
                          <TableCell>{line.qty}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeDraftLine(index)}
                            >
                              <Trash2 className="h-4 w-4" />
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
                <CardTitle>Cola de pedidos para preparar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeCompleted}
                      onChange={(event) => setIncludeCompleted(event.target.checked)}
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    Mostrar completados
                  </label>

                  <div className="min-w-[220px] space-y-2">
                    <Label htmlFor="queue-source-filter">Origen</Label>
                    <NativeSelect
                      id="queue-source-filter"
                      value={queueSourceFilter}
                      onChange={(event) => setQueueSourceFilter(event.target.value)}
                    >
                      <option value="all">Todos</option>
                      <option value="manual">Solo manuales</option>
                      <option value="prestashop">Solo PrestaShop</option>
                    </NativeSelect>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Origen</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Almacen</TableHead>
                      <TableHead>Progreso</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead className="text-right">Picking</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          Sin pedidos
                        </TableCell>
                      </TableRow>
                    ) : (
                      queue.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>#{order.id}</TableCell>
                          <TableCell>{sourceBadge(order.source)}</TableCell>
                          <TableCell>
                            <StatusPill status={order.status} />
                          </TableCell>
                          <TableCell>{order.warehouse_name || "-"}</TableCell>
                          <TableCell>
                            {asNumber(order.picked_qty)}/{asNumber(order.total_qty)}
                          </TableCell>
                          <TableCell>{asNumber(order.progress_pct)}%</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/picking?order=${order.id}`}>Abrir</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        </TabsContent>
        <TabsContent value="prestashop" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pedidos recibidos de PrestaShop</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[250px] space-y-2">
                  <Label htmlFor="ps-import-warehouse">Almacen para reserva/importacion</Label>
                  <NativeSelect
                    id="ps-import-warehouse"
                    value={prestashopWarehouseId}
                    onChange={(event) => setPrestashopWarehouseId(event.target.value)}
                  >
                    <option value="">Selecciona almacen</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-end text-sm text-muted-foreground">
                  <Badge variant="secondary">{prestashopMeta.count} pedidos</Badge>
                  <span>Ultima lectura: {formatDateTime(prestashopMeta.pulledAt)}</span>
                </div>
              </div>

              {prestashopMeta.requestUrl ? (
                <p className="rounded-md bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {prestashopMeta.requestUrl}
                </p>
              ) : null}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID PS</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Accion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prestashopOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Sin pedidos recibidos. Revisa ajustes y prueba conexion.
                      </TableCell>
                    </TableRow>
                  ) : (
                    prestashopOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>#{order.id}</TableCell>
                        <TableCell className="font-medium">{order.reference || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.currentState || "-"}</Badge>
                        </TableCell>
                        <TableCell>{order.customerId || "-"}</TableCell>
                        <TableCell>{formatMoney(order.totalPaid)}</TableCell>
                        <TableCell>{formatDateTime(order.dateAdd)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => previewPrestashopOrder(order.id)}
                            disabled={isPreviewLoading && selectedPrestashopOrderId === order.id}
                          >
                            <Eye />
                            Previsualizar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {previewData ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Previsualizacion pedido PS #{previewData.order?.id} ({previewData.order?.reference || "-"})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">Lineas: {previewData.totals?.lines || 0}</Badge>
                  <Badge variant="success">Mapeadas: {previewData.mappedLines?.length || 0}</Badge>
                  <Badge variant={previewData.unmappedLines?.length > 0 ? "danger" : "outline"}>
                    Sin mapear: {previewData.unmappedLines?.length || 0}
                  </Badge>
                  <Badge
                    variant={previewData.totals?.insufficientLines > 0 ? "warning" : "outline"}
                  >
                    Stock insuficiente: {previewData.totals?.insufficientLines || 0}
                  </Badge>
                </div>

                <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Almacen destino: {previewData.warehouseId} | External ID interno: {previewData.externalOrderId}
                </p>

                {prestashopPreview?.existingOrder ? (
                  <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    Este pedido ya existe en el sistema como #{prestashopPreview.existingOrder.id} ({prestashopPreview.existingOrder.status}).
                  </p>
                ) : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU/Ref Presta</TableHead>
                      <TableHead>Producto Presta</TableHead>
                      <TableHead>Cant.</TableHead>
                      <TableHead>Variante local</TableHead>
                      <TableHead>Disp. almacen</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(previewData.mappedLines || []).map((line, index) => (
                      <TableRow key={`mapped-${line.variantId}-${index}`}>
                        <TableCell>{line.sourceSku || line.sourceBarcode || "-"}</TableCell>
                        <TableCell>{line.productName}</TableCell>
                        <TableCell>{line.qty}</TableCell>
                        <TableCell>
                          <p className="font-medium">{line.variantSku}</p>
                          <p className="text-xs text-muted-foreground">{line.variantName}</p>
                        </TableCell>
                        <TableCell>{line.available}</TableCell>
                        <TableCell>
                          <Badge variant={line.enoughStock ? "success" : "warning"}>
                            {line.enoughStock ? "OK" : "Stock insuficiente"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}

                    {(previewData.unmappedLines || []).map((line, index) => (
                      <TableRow key={`unmapped-${index}`}>
                        <TableCell>{line.sourceSku || line.sourceBarcode || "-"}</TableCell>
                        <TableCell>{line.productName}</TableCell>
                        <TableCell>{line.qty}</TableCell>
                        <TableCell className="text-rose-200">No mapeado</TableCell>
                        <TableCell>-</TableCell>
                        <TableCell>
                          <Badge variant="danger">{line.reason || "Sin mapeo"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => importPrestashopOrder(previewData.order?.id)}
                    disabled={!previewCanImport || isImportingPrestashop}
                  >
                    {isImportingPrestashop ? <RefreshCw className="animate-spin" /> : <ArrowDownToLine />}
                    Importar y reservar para picking
                  </Button>

                  {prestashopPreview?.existingOrder ? (
                    <Button variant="outline" asChild>
                      <Link to={`/picking?order=${prestashopPreview.existingOrder.id}`}>
                        Abrir en picking
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ajustes de conexion PrestaShop</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ps-base-url">Base URL tienda</Label>
                  <Input
                    id="ps-base-url"
                    placeholder="https://tu-tienda.com"
                    value={prestashopSettings.baseUrl}
                    onChange={(event) => updatePrestashopSettings("baseUrl", event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Se consultara {" /api/orders , /api/orders/:id "} usando Webservice API.
                  </p>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ps-api-key">API key Webservice</Label>
                  <Input
                    id="ps-api-key"
                    type="password"
                    placeholder={prestashopSettingsMeta.apiKeyMasked || "Introduce una nueva api key"}
                    value={prestashopSettings.apiKey}
                    onChange={(event) => updatePrestashopSettings("apiKey", event.target.value)}
                  />
                  {prestashopSettingsMeta.hasApiKey ? (
                    <p className="text-xs text-muted-foreground">
                      Clave guardada actualmente: {prestashopSettingsMeta.apiKeyMasked}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-300">Aun no hay api key guardada.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ps-default-warehouse">Almacen por defecto</Label>
                  <NativeSelect
                    id="ps-default-warehouse"
                    value={prestashopSettings.defaultWarehouseId}
                    onChange={(event) => updatePrestashopSettings("defaultWarehouseId", event.target.value)}
                  >
                    <option value="">Selecciona almacen</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ps-state-filter">Filtro de estados</Label>
                  <Input
                    id="ps-state-filter"
                    placeholder="2,3,4"
                    value={prestashopSettings.orderStateFilter}
                    onChange={(event) => updatePrestashopSettings("orderStateFilter", event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Opcional. IDs separados por coma.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ps-pull-limit">Limite de pedidos</Label>
                  <Input
                    id="ps-pull-limit"
                    type="number"
                    min="1"
                    max="200"
                    value={prestashopSettings.pullLimit}
                    onChange={(event) => updatePrestashopSettings("pullLimit", event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ps-timeout">Timeout (ms)</Label>
                  <Input
                    id="ps-timeout"
                    type="number"
                    min="1000"
                    max="60000"
                    value={prestashopSettings.timeoutMs}
                    onChange={(event) => updatePrestashopSettings("timeoutMs", event.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Ultima actualizacion</Label>
                  <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {formatDateTime(prestashopSettingsMeta.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={savePrestashopSettings} disabled={isSettingsSaving || isSettingsLoading}>
                  {isSettingsSaving ? <RefreshCw className="animate-spin" /> : <Save />}
                  Guardar ajustes
                </Button>
                <Button
                  variant="outline"
                  onClick={testPrestashopConnection}
                  disabled={isConnectionTesting || isSettingsLoading}
                >
                  {isConnectionTesting ? <RefreshCw className="animate-spin" /> : <Wifi />}
                  Probar conexion
                </Button>
              </div>

              {connectionRequestUrl ? (
                <p className="rounded-md bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {connectionRequestUrl}
                </p>
              ) : null}

              {connectionPreview.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID PS</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {connectionPreview.map((order) => (
                      <TableRow key={`preview-${order.id}`}>
                        <TableCell>#{order.id}</TableCell>
                        <TableCell>{order.reference || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.currentState || "-"}</Badge>
                        </TableCell>
                        <TableCell>{formatMoney(order.totalPaid)}</TableCell>
                        <TableCell>{formatDateTime(order.dateAdd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
