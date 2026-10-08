import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Download, Loader2, Plus, Trash2, Edit, Package, Upload } from "lucide-react";
import { useParams } from "wouter";
import { useState } from "react";
import { ShippingConfigEditor } from "@/components/ShippingConfigEditor";
import { toast } from "sonner";

export default function ShippingProfiles() {
  const { id } = useParams();
  const storeId = parseInt(id || "0");
  const { isAuthenticated, loading } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileConfig, setProfileConfig] = useState<any>({});

  const { data: profiles, refetch: refetchProfiles } = trpc.shippingProfiles.list.useQuery(
    { storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );

  const { data: assignments } = trpc.shippingProfiles.getProductAssignments.useQuery(
    { storeId },
    { enabled: isAuthenticated && storeId > 0 }
  );

  const createProfileMutation = trpc.shippingProfiles.create.useMutation({
    onSuccess: () => {
      toast.success("Shipping profile created successfully");
      refetchProfiles();
      setIsCreateDialogOpen(false);
      setProfileName("");
      setProfileDescription("");
      setProfileConfig({});
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateProfileMutation = trpc.shippingProfiles.update.useMutation({
    onSuccess: () => {
      toast.success("Shipping profile updated successfully");
      refetchProfiles();
      setIsEditDialogOpen(false);
      setEditingProfile(null);
      setProfileName("");
      setProfileDescription("");
      setProfileConfig({});
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteProfileMutation = trpc.shippingProfiles.delete.useMutation({
    onSuccess: () => {
      toast.success("Shipping profile deleted successfully");
      refetchProfiles();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const downloadShippingTemplateMutation = trpc.config.downloadShippingTemplate.useQuery(
    { storeId },
    { enabled: false }
  );

  const importShippingMutation = trpc.config.importShippingBulk.useMutation({
    onSuccess: (data) => {
      toast.success(`Successfully imported ${data.count} shipping configurations`);
      refetchProfiles();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleDownloadTemplate = async () => {
    const result = await downloadShippingTemplateMutation.refetch();
    if (result.data?.csv) {
      const blob = new Blob([result.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shipping_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImportCSV = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        importShippingMutation.mutate({ storeId, csvData: text });
      }
    };
    input.click();
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

  const handleCreateProfile = (config: any) => {
    if (!profileName.trim()) {
      toast.error("Please enter a profile name");
      return;
    }

    createProfileMutation.mutate({
      storeId,
      name: profileName,
      description: profileDescription,
      configJson: JSON.stringify(config),
    });
  };

  const handleUpdateProfile = (config: any) => {
    if (!editingProfile) return;

    updateProfileMutation.mutate({
      profileId: editingProfile.id,
      name: profileName || undefined,
      description: profileDescription || undefined,
      configJson: JSON.stringify(config),
    });
  };

  const handleEditProfile = (profile: any) => {
    setEditingProfile(profile);
    setProfileName(profile.name);
    setProfileDescription(profile.description || "");
    try {
      setProfileConfig(JSON.parse(profile.configJson));
    } catch {
      setProfileConfig({});
    }
    setIsEditDialogOpen(true);
  };

  const handleDeleteProfile = (profileId: number) => {
    if (confirm("Are you sure you want to delete this shipping profile? All product assignments will be removed.")) {
      deleteProfileMutation.mutate({ profileId });
    }
  };

  const getProductCount = (profileId: number) => {
    return assignments?.filter((a) => a.profileId === profileId).length || 0;
  };

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Shipping Profiles</h1>
          <p className="text-muted-foreground mt-1">
            Create reusable shipping configurations and assign them to multiple products
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="gold-gradient-border">
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportCSV} disabled={importShippingMutation.isPending} className="gold-gradient-border">
            {importShippingMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Import CSV
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gold-gradient">
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Shipping Profile</DialogTitle>
              <DialogDescription>
                Create a reusable shipping configuration that can be assigned to multiple products
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-name">Profile Name *</Label>
                <Input
                  id="profile-name"
                  placeholder="e.g., Standard Shipping, Heavy Items, International"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-description">Description (Optional)</Label>
                <Textarea
                  id="profile-description"
                  placeholder="Describe when to use this profile..."
                  value={profileDescription}
                  onChange={(e) => setProfileDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="border-t pt-4">
                <ShippingConfigEditor
                  variantId="new-profile"
                  productTitle="New Shipping Profile"
                  initialConfig={profileConfig}
                  onSave={handleCreateProfile}
                  isSaving={createProfileMutation.isPending}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {!profiles || profiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Shipping Profiles Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first shipping profile to simplify product configuration
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)} className="gold-gradient">
              <Plus className="h-4 w-4 mr-2" />
              Create First Profile
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {profile.name}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({getProductCount(profile.id)} assigned variants)
                      </span>
                    </CardTitle>
                    {profile.description && (
                      <CardDescription className="mt-1">{profile.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditProfile(profile)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteProfile(profile.id)}
                      disabled={deleteProfileMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Created: {new Date(profile.createdAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Shipping Profile</DialogTitle>
            <DialogDescription>
              Update the shipping configuration for this profile
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-profile-name">Profile Name *</Label>
              <Input
                id="edit-profile-name"
                placeholder="e.g., Standard Shipping, Heavy Items"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-profile-description">Description (Optional)</Label>
              <Textarea
                id="edit-profile-description"
                placeholder="Describe when to use this profile..."
                value={profileDescription}
                onChange={(e) => setProfileDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="border-t pt-4">
              <ShippingConfigEditor
                key={editingProfile?.id || "edit"}
                variantId={editingProfile?.id?.toString() || "edit"}
                productTitle={profileName || "Edit Profile"}
                initialConfig={profileConfig}
                onSave={handleUpdateProfile}
                isSaving={updateProfileMutation.isPending}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
