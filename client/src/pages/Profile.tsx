import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, LogOut, Mail, User, ArrowLeft, CreditCard, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function Profile() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();

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

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold">Profile</h1>
      </header>

      {/* Content - centered, no scroll */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-2xl space-y-4">
          {/* Profile Card */}
          <Card className="bg-slate-900/80 border-slate-800 p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold shrink-0">
                {(user.name || "U").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold">{user.name || "User"}</h2>
                <p className="text-slate-400 flex items-center gap-1.5 text-sm">
                  <Mail className="w-3.5 h-3.5" /> {user.email || "No email set"}
                </p>
              </div>
              <Button onClick={handleLogout} variant="destructive" size="sm" className="gap-1.5 shrink-0">
                <LogOut className="w-3.5 h-3.5" /> Logout
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">Plan</p>
                <p className="text-sm font-semibold capitalize text-blue-400">{user.subscriptionTier || "free"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">Status</p>
                <p className="text-sm font-semibold capitalize text-green-400">{user.subscriptionStatus || "active"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">Role</p>
                <p className="text-sm font-semibold capitalize">{user.role || "user"}</p>
              </div>
              <div className="p-2.5 bg-slate-800/60 rounded-lg">
                <p className="text-[10px] text-slate-500 uppercase">Member since</p>
                <p className="text-sm font-semibold">{new Date(user.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </Card>

          {/* Quick Actions */}
          <Card className="bg-slate-900/80 border-slate-800 p-5">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setLocation("/chat")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <User className="w-3.5 h-3.5" /> Back to Chat
              </Button>
              <Button onClick={() => setLocation("/subscription")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <CreditCard className="w-3.5 h-3.5" /> Subscription
              </Button>
              <Button onClick={() => setLocation("/payments")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <Settings className="w-3.5 h-3.5" /> Payments
              </Button>
              <Button onClick={() => setLocation("/pricing")} variant="outline" size="sm" className="gap-1.5 border-slate-700 flex-1">
                <CreditCard className="w-3.5 h-3.5" /> View Plans
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
