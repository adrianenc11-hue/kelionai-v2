import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, LogOut, Mail, User, ArrowLeft, CreditCard, Settings, Camera } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function Profile() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const uploadAvatarMutation = trpc.voice.uploadImage.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/");
    }
  }, [loading, isAuthenticated, setLocation]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Maximum 5MB allowed.");
      return;
    }

    // Show preview immediately
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);

    try {
      // Convert to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const imageBase64 = await base64Promise;

      // Upload to S3 via existing voice.uploadImage mutation
      const { imageUrl } = await uploadAvatarMutation.mutateAsync({
        imageBase64,
        mimeType: file.type,
      });

      // Update user profile with new avatar URL
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: imageUrl }),
      });

      if (res.ok) {
        toast.success("Profile picture updated!");
        utils.auth.me.invalidate();
      } else {
        throw new Error("Failed to save avatar");
      }
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const avatarSrc = previewUrl || user.avatarUrl;

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold">{t('profile.title')}</h1>
      </header>

      {/* Content - centered, no scroll */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-2xl space-y-4">
          {/* Profile Card */}
          <Card className="bg-slate-900/80 border-slate-800 p-5">
            <div className="flex items-center gap-4 mb-4">
              {/* Avatar with upload */}
              <div className="relative group cursor-pointer shrink-0" onClick={handleAvatarClick}>
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt="Profile"
                    className="w-14 h-14 rounded-full object-cover border-2 border-slate-700"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
                    {(user.name || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  ) : (
                    <Camera className="w-5 h-5 text-white" />
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold">{user.name || "User"}</h2>
                <p className="text-slate-400 flex items-center gap-1.5 text-sm">
                  <Mail className="w-3.5 h-3.5" /> {user.email || "No email set"}
                </p>
              </div>
              <Button onClick={handleLogout} variant="destructive" size="sm" className="gap-1.5 shrink-0">
                <LogOut className="w-3.5 h-3.5" /> {t('nav.logout')}
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">{t('profile.plan')}</p>
                <p className="text-sm font-semibold capitalize text-blue-400">{user.subscriptionTier || "free"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">{t('profile.status')}</p>
                <p className="text-sm font-semibold capitalize text-green-400">{user.subscriptionStatus || "active"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">{t('profile.role')}</p>
                <p className="text-sm font-semibold capitalize">{user.role || "user"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">{t('profile.memberSince')}</p>
                <p className="text-sm font-semibold">{new Date(user.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </Card>

          {/* Quick Actions */}
          <Card className="bg-slate-900/80 border-slate-800 p-5">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setLocation("/chat")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <User className="w-3.5 h-3.5" /> {t('nav.backToChat')}
              </Button>
              <Button onClick={() => setLocation("/subscription")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <CreditCard className="w-3.5 h-3.5" /> {t('nav.subscription')}
              </Button>
              <Button onClick={() => setLocation("/payments")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <Settings className="w-3.5 h-3.5" /> {t('nav.payments')}
              </Button>
              <Button onClick={() => setLocation("/pricing")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <CreditCard className="w-3.5 h-3.5" /> {t('nav.viewPlans')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
