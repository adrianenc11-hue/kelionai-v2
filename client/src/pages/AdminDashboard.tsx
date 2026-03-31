import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users, MessageSquare, TrendingUp, Activity } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "health">("overview");

  if (!isAuthenticated || user?.role !== "admin") {
    setLocation("/");
    return null;
  }

  const { data: analytics, isLoading: analyticsLoading } = trpc.admin.getUserAnalytics.useQuery();
  const { data: users, isLoading: usersLoading } = trpc.admin.getAllUsers.useQuery();
  const { data: health, isLoading: healthLoading } = trpc.admin.getSystemHealth.useQuery();
  const { data: revenue, isLoading: revenueLoading } = trpc.admin.getRevenueAnalytics.useQuery();

  const isLoading = analyticsLoading || usersLoading || healthLoading || revenueLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-purple-500/20 bg-purple-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-400 mt-2">System overview and management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-purple-500/20 bg-purple-900/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-8">
            {["overview", "users", "health"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`py-4 px-2 border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-purple-500 text-purple-300"
                    : "border-transparent text-gray-400 hover:text-gray-300"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Key Metrics */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Total Users</p>
                    <p className="text-3xl font-bold mt-2">{analytics?.totalUsers}</p>
                  </div>
                  <Users className="w-8 h-8 text-purple-400 opacity-50" />
                </div>
              </Card>

              <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Active Users (30d)</p>
                    <p className="text-3xl font-bold mt-2">{analytics?.activeUsers}</p>
                  </div>
                  <Activity className="w-8 h-8 text-green-400 opacity-50" />
                </div>
              </Card>

              <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Total Conversations</p>
                    <p className="text-3xl font-bold mt-2">{analytics?.totalConversations}</p>
                  </div>
                  <MessageSquare className="w-8 h-8 text-blue-400 opacity-50" />
                </div>
              </Card>

              <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Estimated MRR</p>
                    <p className="text-3xl font-bold mt-2">${revenue?.estimatedMRR}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-400 opacity-50" />
                </div>
              </Card>
            </div>

            {/* Subscription Breakdown */}
            <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
              <h3 className="text-xl font-bold mb-6">Subscription Breakdown</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <p className="text-gray-400 text-sm">Free Users</p>
                  <p className="text-2xl font-bold mt-2">{analytics?.usersByTier.free}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {((analytics?.usersByTier.free || 0) / (analytics?.totalUsers || 1) * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Pro Users</p>
                  <p className="text-2xl font-bold mt-2">{analytics?.usersByTier.pro}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {((analytics?.usersByTier.pro || 0) / (analytics?.totalUsers || 1) * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Enterprise Users</p>
                  <p className="text-2xl font-bold mt-2">{analytics?.usersByTier.enterprise}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {((analytics?.usersByTier.enterprise || 0) / (analytics?.totalUsers || 1) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <Card className="bg-purple-900/20 border border-purple-500/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-purple-500/20 bg-purple-900/30">
                    <th className="px-6 py-4 text-left text-sm font-semibold">User</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Email</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Tier</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/20">
                  {users?.slice(0, 10).map((u) => (
                    <tr key={u.id} className="hover:bg-purple-900/20 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">{u.name || "Unknown"}</td>
                      <td className="px-6 py-4 text-sm text-gray-300">{u.email || "—"}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            u.subscriptionTier === "free"
                              ? "bg-gray-500/20 text-gray-300"
                              : u.subscriptionTier === "pro"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-pink-500/20 text-pink-300"
                          }`}
                        >
                          {u.subscriptionTier}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            u.subscriptionStatus === "active"
                              ? "bg-green-500/20 text-green-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {u.subscriptionStatus}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Health Tab */}
        {activeTab === "health" && (
          <div className="space-y-6">
            <Card className="bg-purple-900/20 border border-purple-500/20 p-6">
              <h3 className="text-xl font-bold mb-4">System Status</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Database</span>
                  <span
                    className={`px-3 py-1 rounded text-sm font-semibold ${
                      health?.database === "connected"
                        ? "bg-green-500/20 text-green-300"
                        : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {health?.database}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Uptime</span>
                  <span className="text-gray-300">{(health?.uptime || 0).toFixed(0)}s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Memory Usage</span>
                  <span className="text-gray-300">
                    {((health?.memoryUsage?.heapUsed || 0) / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
