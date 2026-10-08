import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { todayInStore } from "@/lib/store-date";
import { Loader2 } from "lucide-react";
import { useParams } from "wouter";
import { useState } from "react";

export default function Orders() {
  const { id } = useParams();
  const storeId = parseInt(id || "0");
  const { isAuthenticated, loading } = useAuth();
  
  const today = new Date();
  
  const [startDate, setStartDate] = useState(today.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split("T")[0]);
  const [rangeTouched, setRangeTouched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: store } = trpc.stores.getById.useQuery({ id: storeId }, {
    enabled: isAuthenticated && storeId > 0,
  });
  const storeToday = todayInStore(store?.timezone);
  const selectedStartDate = rangeTouched ? startDate : storeToday;
  const selectedEndDate = rangeTouched ? endDate : storeToday;

  const { data, isLoading, error } = trpc.orders.listWithProfit.useQuery(
    { storeId, startDate: selectedStartDate, endDate: selectedEndDate },
    { enabled: isAuthenticated && storeId > 0 && !!store, retry: false }
  );
  
  const orders = (data as any) || [];

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatDate = (dateInput: string | Date | null | undefined) => {
    if (!dateInput) return "Invalid date";
    try {
      const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
      if (isNaN(date.getTime())) return "Invalid date";
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "Invalid date";
    }
  };

  const getProfitColor = (profit: number) => {
    if (profit > 0) return "text-green-500";
    if (profit < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-bold gold-text">Orders</h2>
            <p className="text-muted-foreground mt-1">
              Created-date order contribution; refunds and disputes post to the dashboard on their Shopify Payments transaction dates.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <Label htmlFor="start-date" className="text-xs">From</Label>
              <Input
                id="start-date"
                type="date"
                value={selectedStartDate}
                max={selectedEndDate}
                onChange={(e) => {
                  if (!rangeTouched) setEndDate(storeToday);
                  setStartDate(e.target.value);
                  setRangeTouched(true);
                }}
                className="w-40 date-input-gold"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date" className="text-xs">To</Label>
              <Input
                id="end-date"
                type="date"
                value={selectedEndDate}
                min={selectedStartDate}
                onChange={(e) => {
                  if (!rangeTouched) setStartDate(storeToday);
                  setEndDate(e.target.value);
                  setRangeTouched(true);
                }}
                className="w-40 date-input-gold"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search by Order ID (e.g., 18306)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
          {searchQuery && (
            <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Card className="border-red-500/40">
          <CardContent className="py-6 text-red-300">Orders could not be verified: {error.message}</CardContent>
        </Card>
      ) : orders && orders.length > 0 ? (
        <div className="space-y-4">
          {orders
            .filter((order: any) => {
              if (!searchQuery) return true;
              const orderIdStr = String(order.orderNumber || "");
              return orderIdStr.includes(searchQuery);
            })
            .map((order: any) => (
            <Card key={order.id} className="card-glow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-semibold text-lg">Order #{order.orderNumber}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {order.country && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          📍 {order.country}
                        </span>
                      )}
                      {order.shippingType && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          🚚 {order.shippingType === 'free' ? 'Standard' : order.shippingType.charAt(0).toUpperCase() + order.shippingType.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Order Contribution</p>
                    <p className={`text-2xl font-bold ${getProfitColor(order.profit)}`}>
                      {formatCurrency(order.profit)}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {order.lineItems.map((item: any, idx: number) => (
                    <div key={idx} className="glass p-3 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Quantity: {item.quantity} × {formatCurrency(item.price)}
                          </p>
                        </div>
                        <p className="font-semibold">{formatCurrency(item.quantity * item.price)}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-2 pt-2 border-t border-white/5">
                        <div>
                          <p className="text-xs text-muted-foreground">COGS</p>
                          <p className="text-sm font-medium">{formatCurrency(item.cogs || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Shipping</p>
                          <p className="text-sm font-medium">{formatCurrency(item.shipping || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Discount</p>
                          <p className="text-sm font-medium">{formatCurrency(item.discount || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Item Contribution Margin*</p>
                          <p className={`text-sm font-semibold ${(item.quantity * item.price) > 0 ? (item.profit / (item.quantity * item.price) * 100) >= 0 ? "text-green-500" : "text-red-500" : "text-muted-foreground"}`}>
                            {(item.quantity * item.price) > 0 ? ((item.profit / (item.quantity * item.price)) * 100).toFixed(1) : "0.0"}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Item Contribution*</p>
                          <p className={`text-sm font-semibold ${getProfitColor(item.profit || 0)}`}>
                            {formatCurrency(item.profit || 0)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Revenue</p>
                      <p className="font-semibold">{formatCurrency(order.totalRevenue)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Shipping Revenue</p>
                      <p className="font-semibold text-green-500">{formatCurrency(order.shippingRevenue || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tip</p>
                      <p className="font-semibold text-green-500">{formatCurrency(order.tip || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total COGS</p>
                      <p className="font-semibold">{formatCurrency(order.totalCogs)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Shipping Cost</p>
                      <p className="font-semibold">{formatCurrency(order.totalShipping)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Payment Fee ({order.processingFeeSource === "shopify" ? "posted" : "estimated"})
                      </p>
                      <p className="font-semibold">{formatCurrency(order.totalProcessingFees)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Profit Margin</p>
                      <p className={`font-semibold ${order.totalRevenue > 0 ? (order.profit / order.totalRevenue * 100) >= 0 ? "text-green-500" : "text-red-500" : "text-muted-foreground"}`}>
                        {order.totalRevenue > 0 ? ((order.profit / order.totalRevenue) * 100).toFixed(1) : "0.0"}%
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    * Item contribution excludes order-level payment fees, shipping revenue and tips.
                    Order contribution excludes later refunds, disputes, ad spend and operating expenses.
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="glass">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-2">No orders found for this date range</p>
            <p className="text-sm text-muted-foreground">
              Try adjusting the date range or check your Shopify connection
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
