import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STEP_BADGE_VARIANT = {
  info: "secondary",
  success: "success",
  warning: "warning",
};

export function ProcessGuide({ title = "Flujo recomendado", description, steps = [] }) {
  if (!steps.length) return null;

  return (
    <Card className="border-border/70 bg-card/85">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-lg">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step, index) => (
            <div
              key={`${step.title}-${index}`}
              className="rounded-xl border border-border/60 bg-background/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge variant={STEP_BADGE_VARIANT[step.tone] || "outline"}>Paso {index + 1}</Badge>
                {step.tag ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-[0.08em]">
                    {step.tag}
                  </Badge>
                ) : null}
              </div>
              <p className="font-medium">{step.title}</p>
              {step.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
