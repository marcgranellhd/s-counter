import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT = {
  pending: "warning",
  picking: "secondary",
  completed: "success",
};

export function StatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();

  return (
    <Badge variant={STATUS_VARIANT[normalized] || "outline"} className="uppercase tracking-wide">
      {normalized || "unknown"}
    </Badge>
  );
}
