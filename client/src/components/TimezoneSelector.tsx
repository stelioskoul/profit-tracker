import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface TimezoneSelectorProps {
  storeId: number;
}

const TIMEZONES = [
  { label: "Eastern Time (New York)", value: "America/New_York" },
  { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
  { label: "Hawaii", value: "Pacific/Honolulu" },
  { label: "United Kingdom", value: "Europe/London" },
  { label: "Greece", value: "Europe/Athens" },
  { label: "India", value: "Asia/Kolkata" },
  { label: "Japan", value: "Asia/Tokyo" },
  { label: "Australia (Sydney)", value: "Australia/Sydney" },
];

export default function TimezoneSelector({ storeId }: TimezoneSelectorProps) {
  const [selectedTimezone, setSelectedTimezone] = useState("America/New_York");
  const { data: store, refetch } = trpc.stores.getById.useQuery({ id: storeId });
  const updateStore = trpc.stores.update.useMutation({
    onSuccess: () => {
      toast.success("Reporting timezone updated");
      refetch();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (store?.timezone) setSelectedTimezone(store.timezone);
  }, [store?.timezone]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="timezone">Store timezone</Label>
        <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
          <SelectTrigger id="timezone"><SelectValue placeholder="Select timezone" /></SelectTrigger>
          <SelectContent>
            {TIMEZONES.map(tz => (
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        The selected IANA timezone, including daylight saving time, defines each reporting day.
      </p>
      <Button onClick={() => updateStore.mutate({ id: storeId, timezone: selectedTimezone })}
        disabled={updateStore.isPending || selectedTimezone === store?.timezone}>
        {updateStore.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Save Timezone
      </Button>
    </div>
  );
}
