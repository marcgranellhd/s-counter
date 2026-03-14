import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  Package,
  RefreshCw,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api, endpoints } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/catalog", label: "Catalogo", icon: Package },
  { to: "/inventory", label: "Inventario", icon: Boxes },
  { to: "/orders", label: "Pedidos", icon: ShoppingCart },
  { to: "/picking", label: "Picking", icon: ClipboardCheck },
  { to: "/transfers", label: "Traspasos", icon: ArrowLeftRight },
];

export function AppLayout() {
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [isInitLoading, setIsInitLoading] = useState(false);
  const [isSeedLoading, setIsSeedLoading] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadStatus() {
      try {
        const data = await api(endpoints.status);
        if (!ignore) setStatus(data);
      } catch {
        if (!ignore) setStatus(null);
      }
    }

    loadStatus();

    return () => {
      ignore = true;
    };
  }, []);

  const activeLabel = useMemo(() => {
    const item = NAV_ITEMS.find((entry) => {
      if (entry.to === "/") return location.pathname === "/";
      return location.pathname.startsWith(entry.to);
    });

    return item?.label || "SeedStock";
  }, [location.pathname]);

  async function runInit() {
    try {
      setIsInitLoading(true);
      await api(endpoints.setupInit, { method: "POST" });
      toast.success("Sistema inicializado correctamente");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsInitLoading(false);
    }
  }

  async function runSeed() {
    try {
      setIsSeedLoading(true);
      await api(endpoints.seedDemo, { method: "POST" });
      toast.success("Datos demo cargados");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSeedLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 top-12 h-72 w-72 animate-float rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute right-0 top-0 h-96 w-96 animate-float rounded-full bg-emerald-400/20 blur-3xl [animation-delay:1s]" />
        <div className="absolute inset-0 bg-grid-muted opacity-70" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className="hidden w-72 shrink-0 border-r border-border/60 bg-card/65 p-6 backdrop-blur-xl lg:block">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/20 text-primary shadow-lg shadow-primary/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold">SeedStock Control</p>
              <p className="text-xs text-muted-foreground">Warehouse command center</p>
            </div>
          </Link>

          <Separator className="my-6" />

          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-all",
                      isActive &&
                        "bg-primary/20 text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    )
                  }
                >
                  <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-8 rounded-xl border border-border/60 bg-background/60 p-4 text-xs text-muted-foreground">
            <p className="font-semibold uppercase tracking-[0.08em] text-foreground">Estado</p>
            <p className="mt-2">Fase: {status?.phase || "mvp"}</p>
            <p className="mt-1">Modulos: {status?.modules?.length || 0}</p>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-xl">
            <div className="container flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Modulo activo</p>
                <p className="font-display text-xl font-semibold">{activeLabel}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={runInit} disabled={isInitLoading}>
                  {isInitLoading ? <RefreshCw className="animate-spin" /> : null}
                  Inicializar
                </Button>
                <Button variant="secondary" onClick={runSeed} disabled={isSeedLoading}>
                  {isSeedLoading ? <RefreshCw className="animate-spin" /> : null}
                  Cargar demo
                </Button>
              </div>
            </div>

            <div className="container pb-4 lg:hidden">
              <div className="flex gap-2 overflow-x-auto">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "inline-flex shrink-0 items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground",
                          isActive && "bg-primary/20 text-foreground"
                        )
                      }
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </header>

          <main className="container flex-1 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
