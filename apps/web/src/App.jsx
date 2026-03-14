import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/layout/app-layout";
import { CatalogPage } from "@/pages/catalog-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { InventoryPage } from "@/pages/inventory-page";
import { OrdersPage } from "@/pages/orders-page";
import { PickingPage } from "@/pages/picking-page";
import { TransfersPage } from "@/pages/transfers-page";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/picking" element={<PickingPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
