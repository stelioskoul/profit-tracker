import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, Clock, CalendarDays } from "lucide-react";
import { GoldCoinSpinner } from "@/components/GoldLoader";
import { Link, useLocation, useParams } from "wouter";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import Connections from "./Connections";
import Products from "./Products";
import Expenses from "./Expenses";
import Orders from "./Orders";
import Settings from "./Settings";
import ShippingProfiles from "./ShippingProfiles";
import ExchangeRateDisplay from "@/components/ExchangeRateDisplay";
import { todayInStore } from "@/lib/store-date";


export default function StoreView() {
  const { id } = useParams();
  const storeId = parseInt(id || "0");
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");

  // Memoize today's date to prevent recalculation on every render
  const todayString = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Default to today only (not last 30 days)
  const [startDate, setStartDate] = useState(todayString);
  const [endDate, setEndDate] = useState(todayString);
  const [userSelectedRange, setUserSelectedRange] = useState(false);

  const { data: store, isLoading: storeLoading } = trpc.stores.getById.useQuery(
    { id: storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );
  const storeToday = useMemo(() => todayInStore(store?.timezone), [store?.timezone]);
  const selectedStartDate = userSelectedRange ? startDate : storeToday;
  const selectedEndDate = userSelectedRange ? endDate : storeToday;

  const { data: metrics, isLoading: metricsLoading, error, refetch } = trpc.metrics.getProfit.useQuery(
    { storeId, fromDate: selectedStartDate, toDate: selectedEndDate },
    { enabled: isAuthenticated && storeId > 0 && !!store, retry: false }
  );

  // Removed caching - using direct getProfit for always fresh data

  const exchangeRate = metrics?.exchangeRateUsed ?? 1;

  if (loading || storeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <GoldCoinSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  if (!store) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="glass">
          <CardContent className="p-6">
            <p className="text-muted-foreground">Store not found</p>
            <Button onClick={() => setLocation("/dashboard")} className="mt-4">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatCurrencyUSD = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatCurrencyEUR = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "EUR",
    }).format(value);
  };

  return (
    <div className="min-h-screen">
      <div className="container py-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-4xl font-bold gold-text">{store.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <p className="text-muted-foreground">Track your store's profitability</p>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">{store.timezone?.replace(/_/g, ' ') || "America/New York"}</span>
              </div>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="w-full overflow-x-auto pb-2 -mb-2">
            <TabsList className="glass-strong inline-flex w-auto min-w-full">
            <TabsTrigger value="dashboard" className="data-[state=active]:gold-gradient">
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="shipping-profiles" className="data-[state=active]:gold-gradient">
              Shipping Profiles
            </TabsTrigger>
            <TabsTrigger value="products" className="data-[state=active]:gold-gradient">
              Products
            </TabsTrigger>
            <TabsTrigger value="expenses" className="data-[state=active]:gold-gradient">
              Expenses
            </TabsTrigger>
            <TabsTrigger value="orders" className="data-[state=active]:gold-gradient">
              Orders
            </TabsTrigger>
            <TabsTrigger value="connections" className="data-[state=active]:gold-gradient">
              Connections
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:gold-gradient">
              Settings
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="dashboard" className="space-y-6">
            {/* Date Range Picker */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 glass p-4 rounded-lg">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="start-date" className="text-sm font-medium">
                  From
                </label>
                <input
                  type="date"
                  id="start-date"
                  value={selectedStartDate}
                  max={selectedEndDate}
                  onChange={(e) => {
                    if (!userSelectedRange) setEndDate(storeToday);
                    setStartDate(e.target.value);
                    setUserSelectedRange(true);
                  }}
                  className="px-3 py-2 rounded-md border border-border bg-black/30 text-foreground date-input-gold"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="end-date" className="text-sm font-medium">
                  To
                </label>
                <input
                  type="date"
                  id="end-date"
                  value={selectedEndDate}
                  min={selectedStartDate}
                  onChange={(e) => {
                    if (!userSelectedRange) setStartDate(storeToday);
                    setEndDate(e.target.value);
                    setUserSelectedRange(true);
                  }}
                  className="px-3 py-2 rounded-md border border-border bg-black/30 text-foreground date-input-gold"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              {/* Date Range Presets Dropdown */}
              <Select
                onValueChange={(value) => {
                  const today = new Date(`${storeToday}T12:00:00Z`);
                  let fromDate: Date;
                  let toDate: Date = new Date(today);
                  
                  switch (value) {
                    case 'today':
                      fromDate = new Date(today);
                      break;
                    case 'yesterday':
                      fromDate = new Date(today);
                      fromDate.setUTCDate(today.getUTCDate() - 1);
                      toDate = new Date(fromDate);
                      break;
                    case 'last7':
                      fromDate = new Date(today);
                      fromDate.setUTCDate(today.getUTCDate() - 6);
                      break;
                    case 'last30':
                      fromDate = new Date(today);
                      fromDate.setUTCDate(today.getUTCDate() - 29);
                      break;
                    case 'thisMonth':
                      fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
                      toDate = new Date(today);
                      break;
                    case 'lastMonth':
                      fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1, 12));
                      toDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12));
                      break;
                    default:
                      return;
                  }
                  
                  setStartDate(fromDate.toISOString().slice(0, 10));
                  setEndDate(toDate.toISOString().slice(0, 10));
                  setUserSelectedRange(true);
                }}
              >
                <SelectTrigger className="w-[150px] h-9 bg-black/30 border-border">
                  <CalendarDays className="h-4 w-4 mr-2 text-primary" />
                  <SelectValue placeholder="Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="last7">Last 7 Days</SelectItem>
                  <SelectItem value="last30">Last 30 Days</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                </SelectContent>
              </Select>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <div className="flex flex-col items-stretch sm:items-end gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    disabled={metricsLoading}
                    className="gold-gradient-border"
                  >
                    {metricsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Refresh Data
                  </Button>
                  {/* Removed lastRefreshed display - no caching */}
                </div>
                <ExchangeRateDisplay rate={metrics?.exchangeRateUsed} />
              </div>
            </div>

            {metricsLoading ? (
              <div className="flex items-center justify-center py-12">
                <GoldCoinSpinner />
              </div>
            ) : error ? (
              <Card className="glass">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-destructive mb-2">Error loading metrics</p>
                  <p className="text-sm text-muted-foreground text-center max-w-md">
                    {error.message}
                  </p>
                </CardContent>
              </Card>
            ) : metrics && !metrics.dataQuality.shopifyConnected ? (
              <Card className="glass">
                <CardContent className="space-y-4 p-6">
                  <h2 className="text-lg font-semibold">Connect Shopify to calculate profit</h2>
                  <p className="text-sm text-muted-foreground">
                    This store has no Shopify connection. Zero sales, refunds and disputes are not verified figures.
                    Connect the store and grant order, dispute and Shopify Payments payout access.
                  </p>
                  <Button onClick={() => setActiveTab("connections")}>Open Connections</Button>
                </CardContent>
              </Card>
            ) : metrics ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Sales and product costs follow the order creation date; payment fees, refunds,
                  dispute debits and recoveries follow Shopify Payments' processed date.
                  Case outcomes below show their current status for disputes initiated in this range.
                </p>
                {metrics.dataQuality.warnings.length > 0 && (
                  <Card className="glass border-amber-500/40">
                    <CardContent className="p-4 space-y-2">
                      <p className="font-semibold text-amber-400">Data limitations — profit may be incomplete</p>
                      {metrics.dataQuality.warnings.map((warning, index) => (
                        <p key={index} className="text-sm text-muted-foreground">{warning}</p>
                      ))}
                    </CardContent>
                  </Card>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="card-glow">
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground mb-2">Total Revenue</p>
                      <p className="text-3xl font-bold gold-text">
                        {formatCurrencyUSD(metrics.revenue)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatCurrencyEUR(metrics.revenue / exchangeRate)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="card-glow">
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground mb-2">Classified Costs</p>
                      <p className="text-3xl font-bold text-red-500">
                        {formatCurrencyUSD(metrics.totalCosts)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatCurrencyEUR(metrics.totalCosts / exchangeRate)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="card-glow">
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground mb-2">Estimated Operating Profit</p>
                      <p className={`text-3xl font-bold ${metrics.netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrencyUSD(metrics.netProfit)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatCurrencyEUR(metrics.netProfit / exchangeRate)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="card-glow">
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground mb-2">Profit Margin</p>
                      <p className={`text-3xl font-bold ${(metrics.revenue > 0 ? (metrics.netProfit / metrics.revenue * 100) : 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {(metrics.revenue > 0 ? (metrics.netProfit / metrics.revenue * 100) : 0).toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Cost Breakdown Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Product Costs */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-amber-500 mb-3">Product Costs</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">COGS</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.cogs)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR(metrics.cogs / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Shipping</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.shipping)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR(metrics.shipping / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.cogs + metrics.shipping)}</div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Transaction Fees */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-amber-500 mb-3">Transaction Fees</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Posted Shopify Payments fees</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.processingFees)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR(metrics.processingFees / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Refunds</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.refunds || 0)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR((metrics.refunds || 0) / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.processingFees + (metrics.refunds || 0))}</div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Marketing */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-amber-500 mb-3">Marketing</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Ad Spend</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.adSpend)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR(metrics.adSpend / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.adSpend)}</div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Operational */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-amber-500 mb-3">Operational</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Operational Expenses</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.operationalExpenses)}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrencyEUR(metrics.operationalExpenses / exchangeRate)}</div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className="font-semibold text-sm">{formatCurrencyUSD(metrics.operationalExpenses)}</div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Actual dispute credits posted to the Shopify Payments ledger. */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-green-500 mb-3">Dispute credits (posted)</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Value Recovered</span>
                        <div className="text-right">
                          <div className={`font-semibold text-sm ${(metrics.disputeRecovered || 0) > 0 ? 'text-green-500' : ''}`}>
                            {(metrics.disputeRecovered || 0) > 0 ? '+' : ''}{formatCurrencyUSD(metrics.disputeRecovered || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {(metrics.disputeRecovered || 0) > 0 ? '+' : ''}{formatCurrencyEUR((metrics.disputeRecovered || 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Fees Recovered</span>
                        <div className="text-right">
                          <div className={`font-semibold text-sm ${(metrics.disputeFeesRecovered || 0) > 0 ? 'text-green-500' : ''}`}>
                            {(metrics.disputeFeesRecovered || 0) > 0 ? '+' : ''}{formatCurrencyUSD(metrics.disputeFeesRecovered || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {(metrics.disputeFeesRecovered || 0) > 0 ? '+' : ''}{formatCurrencyEUR((metrics.disputeFeesRecovered || 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className={`font-semibold text-sm ${((metrics.disputeRecovered || 0) + (metrics.disputeFeesRecovered || 0)) > 0 ? 'text-green-500' : ''}`}>
                          {((metrics.disputeRecovered || 0) + (metrics.disputeFeesRecovered || 0)) > 0 ? '+' : ''}{formatCurrencyUSD((metrics.disputeRecovered || 0) + (metrics.disputeFeesRecovered || 0))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Debits can occur while a chargeback is still pending. */}
                  <Card className="glass">
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-red-500 mb-3">Dispute debits (posted)</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Principal debited</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm text-red-500">
                            -{formatCurrencyUSD(metrics.disputeValue || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            -{formatCurrencyEUR((metrics.disputeValue || 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">Fees debited</span>
                        <div className="text-right">
                          <div className="font-semibold text-sm text-red-500">
                            -{formatCurrencyUSD(metrics.disputeFees || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            -{formatCurrencyEUR((metrics.disputeFees || 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-2 mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm font-medium">Subtotal</span>
                        <div className="font-semibold text-sm text-red-500">
                          -{formatCurrencyUSD((metrics.disputeValue || 0) + (metrics.disputeFees || 0))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="glass">
                  <CardContent className="p-4 space-y-2">
                    <h3 className="font-semibold text-sm text-amber-500">Dispute case outcomes</h3>
                    <p className="text-xs text-muted-foreground">
                      Current status of cases initiated in this range — won: {metrics.disputeCases.won},
                      lost: {metrics.disputeCases.lost}, accepted: {metrics.disputeCases.accepted},
                      pending: {metrics.disputeCases.pending}, refunded: {metrics.disputeCases.refunded}.
                      These case amounts are not additional payment transactions or profit.
                    </p>
                    {Object.entries(metrics.disputeCases.nominalAmountsByCurrency).map(([currency, amounts]) => (
                      <p key={currency} className="text-xs text-muted-foreground">
                        {currency} disputed face value — won: {new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amounts.won ?? 0)},
                        lost: {new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amounts.lost ?? 0)}
                      </p>
                    ))}
                  </CardContent>
                </Card>

                {/* Order Statistics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <Card className="glass">
                    <CardContent className="p-6 space-y-3">
                      <h3 className="font-semibold text-lg mb-4">Order Statistics</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Total Orders</span>
                        <span className="font-semibold">{metrics.orders}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Average Order Value</span>
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatCurrencyUSD(metrics.orders > 0 ? metrics.revenue / metrics.orders : 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrencyEUR((metrics.orders > 0 ? metrics.revenue / metrics.orders : 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Average Profit per Order{metrics.dataQuality.perOrderFeeEstimates ? " (estimated fees)" : ""}</span>
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatCurrencyUSD(metrics.averageOrderProfit || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrencyEUR((metrics.averageOrderProfit || 0) / exchangeRate)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Average Profit Margin per Order</span>
                        <span className={`font-semibold ${(metrics.averageOrderProfitMargin || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {(metrics.averageOrderProfitMargin || 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">ROAS (Return on Ad Spend)</span>
                        <span className={`font-semibold ${(metrics.roas || 0) >= 1 ? "text-green-500" : "text-red-500"}`}>
                          {(metrics.roas || 0).toFixed(2)}x
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="shipping-profiles">
            <ShippingProfiles />
          </TabsContent>

          <TabsContent value="products">
            <Products />
          </TabsContent>

          <TabsContent value="expenses">
            <Expenses />
          </TabsContent>

          <TabsContent value="orders">
            <Orders />
          </TabsContent>

          <TabsContent value="connections">
            <Connections />
          </TabsContent>

          <TabsContent value="settings">
            <Settings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
