import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { ProcessGuide } from "@/components/process-guide";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, endpoints } from "@/lib/api";
import { asNumber } from "@/lib/utils";

export function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [summaryResponse, queueResponse, inventoryResponse] = await Promise.all([
        api(endpoints.dashboardSummary),
        api(`${endpoints.ordersQueue}?includeCompleted=true`),
        api(endpoints.inventoryBalance),
      ]);

      setSummary(summaryResponse);
      setOrders(queueResponse || []);
      setInventory(inventoryResponse || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const lowStockRows = useMemo(
    () =>
      (inventory || [])
        .filter((item) => asNumber(item.available) <= 10)
        .sort((a, b) => asNumber(a.available) - asNumber(b.available))
        .slice(0, 24),
    [inventory]
  );

  const queueRows = useMemo(
    () => (orders || []).filter((order) => String(order.status || "").toLowerCase() !== "completed"),
    [orders]
  );

  const sourceStats = useMemo(() => {
    return queueRows.reduce(
      (acc, order) => {
        const source = String(order.source || "manual").toLowerCase();
        if (source === "prestashop") {
          acc.prestashop += 1;
        } else {
          acc.manual += 1;
        }

        if (String(order.status || "").toLowerCase() === "picking") {
          acc.inProgress += 1;
        }

        return acc;
      },
      { manual: 0, prestashop: 0, inProgress: 0 }
    );
  }, [queueRows]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Centro de turno"
        description="Prioriza pedidos, vigila stock critico y abre picking sin friccion"
        actions={
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </Button>
        }
      />

      <ProcessGuide
        title="Orden recomendado para trabajar sin errores"
        description="Este orden minimiza cortes de stock y tiempos muertos en preparacion."
        steps={[
          {
            title: "Revisar cola activa",
            detail: "Confirma cuantos pedidos entraron y cuales ya estan en picking.",
            tone: "info",
            tag: "cola",
          },
          {
            title: "Validar stock critico",
            detail: "Si hay faltas, ajusta inventario antes de seguir preparando.",
            tone: "warning",
            tag: "stock",
          },
          {
            title: "Abrir pedido en picking",
            detail: "Empieza por los pendientes y valida por escaneo.",
            tone: "info",
            tag: "picking",
          },
          {
            title: "Cerrar y pasar al siguiente",
            detail: "Completa pedido, confirma y continua la cola.",
            tone: "success",
            tag: "cierre",
          },
        ]}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pedidos pendientes"
          value={asNumber(summary?.orders?.pending)}
          note="Esperando inicio de picking"
        />
        <StatCard
          label="Pedidos en picking"
          value={asNumber(summary?.orders?.picking)}
          note="Preparacion activa"
        />
        <StatCard
          label="Lineas pendientes"
          value={asNumber(summary?.pendingLines)}
          note="Unidades pendientes de escanear"
        />
        <StatCard
          label="SKUs bajo stock <= 10"
          value={asNumber(summary?.lowStockSkus)}
          note="Requieren reposicion"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Prioridad inmediata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-border/60 bg-background/60 p-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                <p className="font-medium">Pedidos para preparar</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {queueRows.length} en cola, {sourceStats.inProgress} en curso.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">Manual: {sourceStats.manual}</Badge>
                <Badge variant="secondary">PrestaShop: {sourceStats.prestashop}</Badge>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/60 p-3">
              <div className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-amber-300" />
                <p className="font-medium">Alertas de stock</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {lowStockRows.length} referencias con disponible bajo.
              </p>
            </div>

            <div className="grid gap-2">
              <Button asChild className="justify-between">
                <Link to="/orders">
                  Gestionar pedidos
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="secondary" className="justify-between">
                <Link to="/picking">
                  Abrir estacion de picking
                  <ClipboardCheck />
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-between">
                <Link to="/inventory">
                  Revisar inventario
                  <Boxes />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader>
            <CardTitle>Cola de pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Almacen</TableHead>
                  <TableHead>Progreso</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Sin pedidos
                    </TableCell>
                  </TableRow>
                ) : (
                  queueRows.slice(0, 14).map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>#{order.id}</TableCell>
                      <TableCell>
                        <StatusPill status={order.status} />
                      </TableCell>
                      <TableCell>{order.warehouse_name || "-"}</TableCell>
                      <TableCell>
                        {asNumber(order.picked_qty)}/{asNumber(order.total_qty)}
                      </TableCell>
                      <TableCell>{asNumber(order.progress_pct)}%</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
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

      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Alertas de stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Almacen</TableHead>
                  <TableHead className="text-right">Disp.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Sin alertas
                    </TableCell>
                  </TableRow>
                ) : (
                  lowStockRows.map((row) => (
                    <TableRow key={`${row.variant_id}-${row.warehouse_id}`}>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell>{row.warehouse_name}</TableCell>
                      <TableCell className="text-right font-semibold text-amber-200">
                        {asNumber(row.available)}
                      </TableCell>
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
