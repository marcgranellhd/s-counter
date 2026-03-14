const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return null;
}

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Error ${response.status}`);
  }

  return data;
}

export const endpoints = {
  status: "/api/status",
  setupInit: "/api/setup/init",
  seedDemo: "/api/demo/seed",
  dashboardSummary: "/api/dashboard/summary",
  products: "/api/products",
  variants: "/api/variants",
  warehouses: "/api/warehouses",
  inventoryBalance: "/api/inventory/balance",
  inventoryMovements: "/api/inventory/movements",
  orders: "/api/orders",
  ordersQueue: "/api/orders/queue",
  prestashopSettings: "/api/integrations/prestashop/settings",
  prestashopTest: "/api/integrations/prestashop/test",
  prestashopOrders: "/api/integrations/prestashop/orders",
  pickingScan: "/api/picking/scan",
  transfers: "/api/transfers",
};
