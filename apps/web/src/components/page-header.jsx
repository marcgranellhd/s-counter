import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
