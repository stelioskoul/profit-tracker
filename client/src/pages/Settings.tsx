import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { toast } from "sonner";

const TIMEZONES = [
  { value: "America/New_York", label: "New York (EST/EDT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST/PDT)" },
  { value: "Europe/Athens", label: "Greece (EET/EEST)" },
];

export default function Settings() {
  const { id } = useParams();
  const storeId = parseInt(id || "0");
  const { isAuthenticated, loading } = useAuth();
  const [selectedTimezone, setSelectedTimezone] = useState<string>("America/New_York");

  const { data: store, refetch: refetchStore } = trpc.stores.getById.useQuery(
    { id: storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );

  const updateStoreMutation = trpc.stores.update.useMutation({
    onSuccess: () => {
      toast.success("Timezone updated successfully. Dashboard will refresh with new timezone.");
      refetchStore();
      // Force reload to refresh dashboard with new timezone
      window.location.reload();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Set initial timezone from store data
  useEffect(() => {
    if (store?.timezone) {
      setSelectedTimezone(store.timezone);
    }
  }, [store]);

  const handleSaveTimezone = () => {
    const timezoneData = TIMEZONES.find((tz) => tz.value === selectedTimezone);
    if (!timezoneData) {
      toast.error("Invalid timezone selected");
      return;
    }

    updateStoreMutation.mutate({
      id: storeId,
      timezone: timezoneData.value,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="container py-8 max-w-4xl">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Timezone Settings</CardTitle>
            <CardDescription>
              Set your preferred timezone for daily reports and analytics. The dashboard will reset daily based on this timezone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="timezone">Store Timezone</Label>
              <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
                <SelectTrigger id="timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">
              Current timezone: <strong>{store?.timezone || "Not set"}</strong>
            </p>

            <Button 
              onClick={handleSaveTimezone} 
              disabled={updateStoreMutation.isPending || selectedTimezone === store?.timezone}
            >
              {updateStoreMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Timezone
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Store Information</CardTitle>
            <CardDescription>Basic information about your store</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Store Name:</div>
              <div className="font-medium">{store?.name}</div>
              
              <div className="text-muted-foreground">Platform:</div>
              <div className="font-medium capitalize">{store?.platform}</div>
              
              <div className="text-muted-foreground">Currency:</div>
              <div className="font-medium">{store?.currency}</div>
              
              <div className="text-muted-foreground">Created:</div>
              <div className="font-medium">
                {store?.createdAt ? new Date(store.createdAt).toLocaleDateString() : "N/A"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
