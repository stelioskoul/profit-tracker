import { trpc } from "@/lib/trpc";
import { TrendingUp } from "lucide-react";

export default function ExchangeRateDisplay({ rate }: { rate?: number }) {
  const { data } = trpc.exchangeRate.getCurrent.useQuery();

  const displayedRate = rate ?? data?.rate;
  if (!displayedRate) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <TrendingUp className="h-4 w-4" />
      <span>EUR/USD {rate ? "(reporting estimate)" : "(current)"}: {displayedRate.toFixed(4)}</span>
    </div>
  );
}
