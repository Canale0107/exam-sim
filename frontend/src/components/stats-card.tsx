import { Card } from "@/components/ui/card";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  className?: string;
}

export function StatsCard({ title, value, icon: Icon, description, className }: StatsCardProps) {
  return (
    <Card className={`p-6 shadow-sm hover:shadow-md transition-all ${className || ""}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground mb-2">{title}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="rounded-xl bg-primary/10 p-3 ml-4 shrink-0 shadow-sm">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

