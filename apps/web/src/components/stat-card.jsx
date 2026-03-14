import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StatCard({ label, value, note }) {
  return (
    <Card className="animate-fade-slide border-border/60 bg-card/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold leading-none">{value}</p>
        {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
