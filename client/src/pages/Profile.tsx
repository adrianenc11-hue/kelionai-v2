import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, LogOut, Mail, User } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function Profile() {
  const { user, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);

  if (!isAuthenticated || !user) {
    setLocation("/");
    return null;
  }

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-purple-500/20 bg-purple-900/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold">Profile Settings</h1>
          <p className="text-gray-400 mt-2">Manage your account and preferences</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Card */}
        <Card className="bg-purple-900/20 border border-purple-500/20 p-8 mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{user.name || "User"}</h2>
              <p className="text-gray-400 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                {user.email || "No email set"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400">Member since</p>
              <p className="text-lg font-semibold">
                {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-6 p-4 bg-purple-900/30 rounded-lg">
            <div>
              <p className="text-sm text-gray-400">Subscription Tier</p>
              <p className="text-lg font-semibold capitalize">{user.subscriptionTier || "free"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Status</p>
              <p className="text-lg font-semibold capitalize">{user.subscriptionStatus || "active"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Role</p>
              <p className="text-lg font-semibold capitalize">{user.role || "user"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Last Sign In</p>
              <p className="text-lg font-semibold">
                {new Date(user.lastSignedIn).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <Button onClick={() => setLocation("/subscription")} variant="outline">
              Manage Subscription
            </Button>
            <Button onClick={() => setLocation("/payments")} variant="outline">
              View Payments
            </Button>
            <Button onClick={handleLogout} variant="destructive" className="ml-auto gap-2">
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>
        </Card>

        {/* Account Information */}
        <Card className="bg-purple-900/20 border border-purple-500/20 p-8">
          <h3 className="text-xl font-bold mb-6">Account Information</h3>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <User className="w-4 h-4 inline mr-2" />
                Full Name
              </label>
              <Input
                type="text"
                value={user.name || ""}
                disabled={!isEditing}
                className="bg-purple-900/20 border-purple-500/20"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <Mail className="w-4 h-4 inline mr-2" />
                Email Address
              </label>
              <Input
                type="email"
                value={user.email || ""}
                disabled={!isEditing}
                className="bg-purple-900/20 border-purple-500/20"
                placeholder="your.email@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Login Method
              </label>
              <Input
                type="text"
                value={user.loginMethod || "Manus OAuth"}
                disabled
                className="bg-purple-900/20 border-purple-500/20"
              />
            </div>

            {isEditing && (
              <div className="flex gap-4 pt-4">
                <Button
                  onClick={() => setIsEditing(false)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500"
                >
                  Save Changes
                </Button>
                <Button onClick={() => setIsEditing(false)} variant="outline">
                  Cancel
                </Button>
              </div>
            )}

            {!isEditing && (
              <Button onClick={() => setIsEditing(true)} variant="outline">
                Edit Profile
              </Button>
            )}
          </div>
        </Card>

        {/* Preferences */}
        <Card className="bg-purple-900/20 border border-purple-500/20 p-8 mt-8">
          <h3 className="text-xl font-bold mb-6">Preferences</h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-purple-900/30 rounded-lg">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-gray-400">Receive updates about your account</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>

            <div className="flex items-center justify-between p-4 bg-purple-900/30 rounded-lg">
              <div>
                <p className="font-medium">Marketing Emails</p>
                <p className="text-sm text-gray-400">Receive news and special offers</p>
              </div>
              <input type="checkbox" className="w-5 h-5" />
            </div>

            <div className="flex items-center justify-between p-4 bg-purple-900/30 rounded-lg">
              <div>
                <p className="font-medium">Two-Factor Authentication</p>
                <p className="text-sm text-gray-400">Add extra security to your account</p>
              </div>
              <Button size="sm" variant="outline">
                Enable
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
