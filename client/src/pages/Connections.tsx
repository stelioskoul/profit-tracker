import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CheckCircle, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

export default function Connections() {
  const { id } = useParams();
  const storeId = parseInt(id || "0");
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [shopDomain, setShopDomain] = useState("");
  const [configuredShop, setConfiguredShop] = useState("");
  const [showManualShopify, setShowManualShopify] = useState(false);
  const [shopifyToken, setShopifyToken] = useState("");
  const [showManualFacebook, setShowManualFacebook] = useState(false);
  const [facebookToken, setFacebookToken] = useState("");
  const [facebookAdAccountId, setFacebookAdAccountId] = useState("");
  const [pendingAccountId, setPendingAccountId] = useState("");
  const [existingConnectionId, setExistingConnectionId] = useState("");
  const [facebookStatus, setFacebookStatus] = useState(() => new URLSearchParams(window.location.search).get("facebook"));
  useEffect(() => {
    const messages: Record<string, string> = { cancelled: "Facebook login was cancelled. You can try again.", no_accounts: "No ad accounts were granted. Log in again and select your ad account.", failed: "Facebook connection failed. Check the app configuration and try again." };
    if (facebookStatus && messages[facebookStatus]) toast.error(messages[facebookStatus]);
  }, [facebookStatus, storeId]);

  const { data: shopifyConn, refetch: refetchShopify } = trpc.shopify.getConnection.useQuery(
    { storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );

  const { data: availableShops } = trpc.shopify.availableStores.useQuery(undefined, { enabled: isAuthenticated });
  const configuredShopifyMutation = trpc.shopify.connectConfigured.useMutation({
    onSuccess: () => {
      toast.success("Shopify connected successfully");
      refetchShopify();
      utils.stores.getById.invalidate({ id: storeId });
      utils.metrics.getProfit.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const { data: facebookConns, refetch: refetchFacebook } = trpc.facebook.getConnections.useQuery(
    { storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );

  const { data: pendingFacebook, error: pendingFacebookError } = trpc.facebook.pendingAccounts.useQuery(
    { storeId }, { enabled: isAuthenticated && storeId > 0, retry: false }
  );
  const { data: existingFacebook } = trpc.facebook.availableConnections.useQuery(undefined, { enabled: isAuthenticated });
  const reusableAccounts = (existingFacebook || []).filter(connection => connection.storeId !== storeId);
  const refreshFacebook = async () => {
    await Promise.all([refetchFacebook(), utils.facebook.availableConnections.invalidate(), utils.facebook.pendingAccounts.invalidate({ storeId }), utils.metrics.getProfit.invalidate()]);
  };
  const pendingFacebookMutation = trpc.facebook.connectPending.useMutation({
    onSuccess: () => {
      toast.success("Facebook ad account connected");
      setPendingAccountId("");
      setFacebookStatus(null);
      window.history.replaceState(null, "", window.location.pathname);
      refreshFacebook();
    },
    onError: error => toast.error(error.message),
  });
  const existingFacebookMutation = trpc.facebook.connectExisting.useMutation({
    onSuccess: () => { toast.success("Facebook ad account connected"); setExistingConnectionId(""); refreshFacebook(); },
    onError: error => toast.error(error.message),
  });

  const shopifyAuthMutation = trpc.shopify.getAuthUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const facebookAuthMutation = trpc.facebook.getAuthUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const shopifyDisconnectMutation = trpc.shopify.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Shopify disconnected");
      refetchShopify();
    },
  });

  const shopifyManualMutation = trpc.shopify.connectManual.useMutation({
    onSuccess: () => {
      toast.success("Shopify connected successfully");
      setShopDomain("");
      setShopifyToken("");
      setShowManualShopify(false);
      refetchShopify();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const facebookDisconnectMutation = trpc.facebook.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Facebook disconnected");
      refreshFacebook();
    },
  });

  const facebookManualMutation = trpc.facebook.connectManual.useMutation({
    onSuccess: () => {
      toast.success("Facebook connected successfully");
      setFacebookToken("");
      setFacebookAdAccountId("");
      setShowManualFacebook(false);
      refreshFacebook();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const handleShopifyConnect = () => {
    if (!shopDomain.trim()) {
      toast.error("Please enter your Shopify store domain");
      return;
    }

    const domain = shopDomain.trim().replace("https://", "").replace("http://", "");
    shopifyAuthMutation.mutate({ shop: domain, storeId });
  };

  const handleFacebookConnect = () => {
    facebookAuthMutation.mutate({ storeId });
  };

  return (
    <div className="min-h-screen">
      <div className="border-b">
        <div className="container flex h-16 items-center">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/store/${storeId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold ml-4">Connections</h1>
        </div>
      </div>

      <div className="container py-8 max-w-4xl">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Shopify</CardTitle>
                  <CardDescription>Connect orders, dispute cases and Shopify Payments activity</CardDescription>
                </div>
                {shopifyConn ? (
                  <CheckCircle className="h-6 w-6 text-green-500" />
                ) : (
                  <XCircle className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {shopifyConn ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">Store: {shopifyConn.shopDomain}</p>
                    <p className="text-sm text-muted-foreground">
                      Connected {new Date(shopifyConn.connectedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => shopifyDisconnectMutation.mutate({ storeId })}
                    disabled={shopifyDisconnectMutation.isPending}
                  >
                    {shopifyDisconnectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {!showManualShopify ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Beprofit needs its own Shopify connection; the separate Manus Shopify plugin does not connect this app automatically.
                        The app token must have read_orders, read_shopify_payments_disputes and read_shopify_payments_payouts.
                      </p>
                      {!!availableShops?.length && (
                        <div className="space-y-3">
                          <Label htmlFor="configuredShop">Shopify Store</Label>
                          <Select value={configuredShop} onValueChange={setConfiguredShop}>
                            <SelectTrigger id="configuredShop"><SelectValue placeholder="Select your Shopify store" /></SelectTrigger>
                            <SelectContent>
                              {availableShops.map(shop => <SelectItem key={shop.shopDomain} value={shop.shopDomain}>{shop.label} ({shop.shopDomain})</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button className="w-full" disabled={!configuredShop || configuredShopifyMutation.isPending}
                            onClick={() => configuredShopifyMutation.mutate({ storeId, shopDomain: configuredShop })}>
                            {configuredShopifyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Connect Shopify
                          </Button>
                        </div>
                      )}
                      <Button variant="outline" onClick={() => setShowManualShopify(true)} className="w-full">
                        Enter Admin API Token
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-2">
                        <Label htmlFor="shopDomain">Shopify Store Domain</Label>
                        <Input
                          id="shopDomain"
                          placeholder="mystore.myshopify.com"
                          value={shopDomain}
                          onChange={(e) => setShopDomain(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="shopifyToken">Admin API Access Token</Label>
                        <Input
                          id="shopifyToken"
                          type="password"
                          placeholder="shpat_xxxxx"
                          value={shopifyToken}
                          onChange={(e) => setShopifyToken(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Create or update a Shopify Admin custom app with read_orders,
                          read_shopify_payments_disputes and read_shopify_payments_payouts,
                          then install or reinstall it and enter its token. Beprofit checks all
                          three read endpoints before saving the connection. Order history older
                          than 60 days also needs Shopify-approved read_all_orders permission.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            if (!shopDomain || !shopifyToken) {
                              toast.error("Please fill in all fields");
                              return;
                            }
                            shopifyManualMutation.mutate({
                              storeId,
                              shopDomain,
                              accessToken: shopifyToken,
                            });
                          }}
                          disabled={shopifyManualMutation.isPending}
                        >
                          {shopifyManualMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Connect
                        </Button>
                        <Button variant="outline" onClick={() => setShowManualShopify(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Facebook Ads</CardTitle>
                  <CardDescription>Connect your Facebook ad account to track ad spend</CardDescription>
                </div>
                {facebookConns && facebookConns.length > 0 ? (
                  <CheckCircle className="h-6 w-6 text-green-500" />
                ) : (
                  <XCircle className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {pendingFacebookError && <p role="alert" className="text-sm text-destructive mb-4">{pendingFacebookError.message}</p>}
              {facebookStatus === "select" && pendingFacebook === null && <p role="alert" className="text-sm text-muted-foreground mb-4">Your Facebook login selection expired. Connect with Facebook OAuth again.</p>}
              {pendingFacebook && (
                <div className="space-y-3 border rounded-lg p-4 mb-4">
                  <p className="font-medium">Facebook login completed. Choose your ad account.</p>
                  <Label htmlFor="pendingFacebookAccount">Facebook ad account</Label>
                  <Select value={pendingAccountId} onValueChange={setPendingAccountId}>
                    <SelectTrigger id="pendingFacebookAccount"><SelectValue placeholder="Select an ad account" /></SelectTrigger>
                    <SelectContent>{pendingFacebook.accounts.map(account => <SelectItem key={account.id} value={account.id}>{account.name} ({account.id}) · {account.currency}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{pendingFacebook.expiresAt ? `Access expires ${new Date(pendingFacebook.expiresAt).toLocaleDateString()}. Reconnect before that date.` : "Access has no scheduled expiry. Reconnect if access is revoked."}</p>
                  <Button disabled={!pendingAccountId || pendingFacebookMutation.isPending} onClick={() => pendingFacebookMutation.mutate({ storeId, adAccountId: pendingAccountId })}>
                    {pendingFacebookMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Connect selected ad account
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mb-4">Ad spend uses the entire ad account for the selected dates. If you connect the same account to multiple stores, each includes that account's spend.</p>
              {facebookConns && facebookConns.length > 0 ? (
                <div className="space-y-4">
                  {facebookConns.map((conn) => (
                    <div key={conn.id} className="flex items-center justify-between border rounded-lg p-4">
                      <div>
                        <p className="text-sm font-medium">{conn.adAccountName || "Facebook ad account"}</p>
                        <p className="text-xs text-muted-foreground">Account: {conn.adAccountId}</p>
                        <p className="text-xs text-muted-foreground">
                          {conn.tokenExpiresAt ? `${new Date(conn.tokenExpiresAt).getTime() <= Date.now() ? "Access expired" : "Access expires"} ${new Date(conn.tokenExpiresAt).toLocaleDateString()}` : conn.tokenType ? "No scheduled expiry · reconnect if access is revoked" : "Token expiry has not been verified"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Connected {new Date(conn.connectedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => facebookDisconnectMutation.mutate({ connectionId: conn.id })}
                        disabled={facebookDisconnectMutation.isPending}
                      >
                        {facebookDisconnectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Disconnect
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={handleFacebookConnect} disabled={facebookAuthMutation.isPending}>
                    Reconnect or add account
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Connect your Facebook ad account to automatically track ad spend and calculate profit.
                  </p>
                  
                  {reusableAccounts.length > 0 && (
                    <div className="space-y-2 border rounded-lg p-4">
                      <Label htmlFor="existingFacebookAccount">Use an account connected to another store</Label>
                      <Select value={existingConnectionId} onValueChange={setExistingConnectionId}>
                        <SelectTrigger id="existingFacebookAccount"><SelectValue placeholder="Select a connected ad account" /></SelectTrigger>
                        <SelectContent>{reusableAccounts.map(connection => <SelectItem key={connection.id} value={String(connection.id)}>{connection.adAccountName || connection.adAccountId} · {connection.storeName}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button disabled={!existingConnectionId || existingFacebookMutation.isPending} onClick={() => existingFacebookMutation.mutate({ storeId, connectionId: Number(existingConnectionId) })}>
                        {existingFacebookMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Connect existing ad account
                      </Button>
                    </div>
                  )}
                  {!showManualFacebook ? (
                    <div className="space-y-2">
                      <Button onClick={handleFacebookConnect} disabled={facebookAuthMutation.isPending}>
                        {facebookAuthMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Connect with Facebook OAuth
                      </Button>
                      <Button variant="outline" onClick={() => setShowManualFacebook(true)} className="w-full">
                        Or enter access token manually
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-2">
                        <Label htmlFor="fbToken">Facebook Access Token</Label>
                        <Input
                          id="fbToken"
                          type="password"
                          placeholder="Enter your long-lived access token"
                          value={facebookToken}
                          onChange={(e) => setFacebookToken(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="adAccountId">Ad Account ID</Label>
                        <Input
                          id="adAccountId"
                          placeholder="act_123456789"
                          value={facebookAdAccountId}
                          onChange={(e) => setFacebookAdAccountId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Find your ad account ID in Facebook Ads Manager
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => {
                            if (!facebookToken || !facebookAdAccountId) {
                              toast.error("Please fill in all fields");
                              return;
                            }
                            facebookManualMutation.mutate({
                              storeId,
                              accessToken: facebookToken,
                              adAccountId: facebookAdAccountId,
                            });
                          }}
                          disabled={facebookManualMutation.isPending}
                        >
                          {facebookManualMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Connect
                        </Button>
                        <Button variant="outline" onClick={() => setShowManualFacebook(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>


        </div>
      </div>
    </div>
  );
}
