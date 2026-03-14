import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Panel operativo"
        description="Resumen de pedidos, stock critico y estado de preparacion"
        actions={
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </Button>
        }
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

      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
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
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Sin pedidos
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.slice(0, 14).map((order) => (
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

        <Card className="xl:col-span-2">
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
