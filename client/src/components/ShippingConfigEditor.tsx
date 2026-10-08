import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { SHIPPING_COUNTRIES, type ShippingCountry } from "@shared/shipping-regions";

type ShippingMethod = "Standard" | "Express";
type Country = ShippingCountry;
type QuantityPricing = Record<number, number | undefined>;
type MethodPricing = Record<ShippingMethod, QuantityPricing>;
type CountryPricing = Record<Country, MethodPricing>;

interface ShippingConfigEditorProps {
  variantId: string;
  productTitle: string;
  initialConfig?: Partial<CountryPricing>;
  onSave: (config: CountryPricing) => void;
  isSaving?: boolean;
}

const COUNTRIES = SHIPPING_COUNTRIES;
const METHODS: ShippingMethod[] = ["Standard", "Express"];

function normalizeConfig(initialConfig?: Partial<CountryPricing>): CountryPricing {
  return Object.fromEntries(COUNTRIES.map(country => [country, {
    Standard: { ...initialConfig?.[country]?.Standard },
    Express: { ...initialConfig?.[country]?.Express },
  }])) as CountryPricing;
}

export function ShippingConfigEditor({
  variantId,
  productTitle,
  initialConfig,
  onSave,
  isSaving = false,
}: ShippingConfigEditorProps) {
  const [config, setConfig] = useState<CountryPricing>(() => normalizeConfig(initialConfig));

  // Update config when initialConfig changes (for edit dialog)
  useEffect(() => {
    if (initialConfig) {
      setConfig(normalizeConfig(initialConfig));
    }
  }, [initialConfig]);

  const updatePrice = (country: Country, method: ShippingMethod, quantity: number, price: string) => {
    const numPrice = price.trim() === "" ? undefined : Number(price);
    if (numPrice !== undefined && (!Number.isFinite(numPrice) || numPrice < 0)) return;

    setConfig(prev => ({
      ...prev,
      [country]: {
        ...prev[country],
        [method]: {
          ...prev[country][method],
          [quantity]: numPrice,
        },
      },
    }));
  };

  const removeQuantity = (country: Country, method: ShippingMethod, quantity: number) => {
    setConfig(prev => {
      const newMethodPricing = { ...prev[country][method] };
      delete newMethodPricing[quantity];
      return {
        ...prev,
        [country]: {
          ...prev[country],
          [method]: newMethodPricing,
        },
      };
    });
  };

  const addQuantity = (country: Country, method: ShippingMethod) => {
    const existingQuantities = Object.keys(config[country]?.[method] || {}).map(Number);
    const nextQuantity = existingQuantities.length > 0 
      ? Math.max(...existingQuantities) + 1 
      : 1;

    setConfig(prev => ({
      ...prev,
      [country]: {
        ...prev[country],
        [method]: {
          ...(prev[country]?.[method] || {}),
          [nextQuantity]: undefined,
        },
      },
    }));
  };

  const handleSave = () => {
    // Validate that at least one price is set
    let hasData = false;
    for (const country of COUNTRIES) {
      for (const method of METHODS) {
        if (Object.values(config[country][method]).some(value => value !== undefined)) {
          hasData = true;
          break;
        }
      }
      if (hasData) break;
    }

    if (!hasData) {
      toast.error("Please add at least one shipping price");
      return;
    }

    onSave(config);
  };

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="gold-text">{productTitle}</CardTitle>
        <CardDescription>
          Configure shipping costs by country, method, and quantity. All prices in USD.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="US" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            {COUNTRIES.map(country => (
              <TabsTrigger key={country} value={country}>
                {country}
              </TabsTrigger>
            ))}
          </TabsList>

          {COUNTRIES.map(country => (
            <TabsContent key={country} value={country} className="space-y-6">
              {METHODS.map(method => {
                const quantities = Object.keys(config[country]?.[method] || {})
                  .map(Number)
                  .sort((a, b) => a - b);

                return (
                  <div key={method} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-lg">{method} Shipping</h4>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addQuantity(country, method)}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Quantity
                      </Button>
                    </div>

                    {quantities.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        No pricing configured. Click "Add Quantity" to start.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {quantities.map(qty => (
                          <div key={qty} className="flex items-center gap-2 p-3 border rounded-lg">
                            <div className="flex-1">
                              <Label htmlFor={`${variantId}-${country}-${method}-${qty}`} className="text-xs text-muted-foreground">
                                {qty} {qty === 1 ? "pc" : "pcs"}
                              </Label>
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-sm font-medium">
                                  $
                                </span>
                                <Input
                                  id={`${variantId}-${country}-${method}-${qty}`}
                                  aria-label={`${country} ${method} shipping for ${qty} ${qty === 1 ? "piece" : "pieces"}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={config[country]?.[method]?.[qty] ?? ""}
                                  onChange={(e) => updatePrice(country, method, qty, e.target.value)}
                                  className="h-8"
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => removeQuantity(country, method, qty)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={isSaving} className="gold-gradient">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Shipping Config"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
