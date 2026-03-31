import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, LogOut, Mail, User, ArrowLeft, Shield, CreditCard, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";

export default function Profile() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();

  // Fix: use useEffect for navigation instead of render-phase
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/");
    }
  }, [loading, isAuthenticated, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950" role="status" aria-label="Loading profile">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white" role="main" aria-label="Profile Settings">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center gap-4">
          <Button onClick={() => setLocation("/chat")} variant="ghost" size="sm" aria-label="Back to chat">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Profile Settings</h1>
            <p className="text-slate-400 text-sm mt-1">Manage your account and preferences</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Profile Card */}
        <Card className="bg-slate-900/80 border-slate-800 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold" aria-hidden="true">
                {(user.name || "U").charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold">{user.name || "User"}</h2>
                <p className="text-slate-400 flex items-center gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5" />
                  {user.email || "No email set"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Member since</p>
              <p className="text-sm font-semibold text-slate-300">
                {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="p-3 bg-slate-800/60 rounded-lg">
              <p className="text-xs text-slate-500">Subscription</p>
              <p className="text-sm font-semibold capitalize text-blue-400">{user.subscriptionTier || "free"}</p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-lg">
              <p className="text-xs text-slate-500">Status</p>
              <p className="text-sm font-semibold capitalize text-green-400">{user.subscriptionStatus || "active"}</p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-lg">
              <p className="text-xs text-slate-500">Role</p>
              <p className="text-sm font-semibold capitalize">{user.role || "user"}</p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-lg">
              <p className="text-xs text-slate-500">Last Sign In</p>
              <p className="text-sm font-semibold">
                {new Date(user.lastSignedIn).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setLocation("/subscription")} variant="outline" size="sm" className="gap-2 border-slate-700">
              <CreditCard className="w-3.5 h-3.5" /> Manage Subscription
            </Button>
            <Button onClick={() => setLocation("/payments")} variant="outline" size="sm" className="gap-2 border-slate-700">
              <Settings className="w-3.5 h-3.5" /> View Payments
            </Button>
            <Button onClick={handleLogout} variant="destructive" size="sm" className="ml-auto gap-2">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </Button>
          </div>
        </Card>

        {/* Account Information */}
        <Card className="bg-slate-900/80 border-slate-800 p-6 md:p-8">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-400" /> Account Information
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Full Name</label>
              <Input
                type="text"
                value={user.name || ""}
                disabled
                className="bg-slate-800/60 border-slate-700"
                aria-label="Full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Email Address</label>
              <Input
                type="email"
                value={user.email || ""}
                disabled
                className="bg-slate-800/60 border-slate-700"
                aria-label="Email address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Login Method</label>
              <Input
                type="text"
                value="Email & Password"
                disabled
                className="bg-slate-800/60 border-slate-700"
                aria-label="Login method"
              />
            </div>
            <p className="text-xs text-slate-500">Profile information is managed through your account settings.</p>
          </div>
        </Card>

        {/* Quick Links */}
        <Card className="bg-slate-900/80 border-slate-800 p-6 md:p-8">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" /> Quick Actions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button onClick={() => setLocation("/chat")} variant="outline" className="justify-start gap-2 border-slate-700 h-auto py-3">
              <div className="text-left">
                <p className="font-medium">Back to Chat</p>
                <p className="text-xs text-slate-500">Continue your conversation</p>
              </div>
            </Button>
            <Button onClick={() => setLocation("/pricing")} variant="outline" className="justify-start gap-2 border-slate-700 h-auto py-3">
              <div className="text-left">
                <p className="font-medium">View Plans</p>
                <p className="text-xs text-slate-500">Upgrade your subscription</p>
              </div>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
