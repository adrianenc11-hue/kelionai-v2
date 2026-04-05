import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function SubscriptionManagement() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/");
    }
  }, [loading, isAuthenticated, setLocation]);

  const { data: subscription, isLoading: subscriptionLoading } = trpc.subscription.getSubscriptionStatus.useQuery(
    undefined, { enabled: isAuthenticated }
  );

  const cancelMutation = trpc.subscription.cancelSubscription.useMutation({
    onSuccess: () => {
      setShowCancelConfirm(false);
      utils.subscription.getSubscriptionStatus.invalidate();
      toast.success("Subscription cancelled successfully.");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const createCheckoutMutation = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) window.open(data.url, "_blank");
    },
  });

  const { data: plans } = trpc.subscription.getPlans.useQuery();

  const defaultPlans = [
    { name: "free", title: "Free", price: "$0", features: ["20 msg/mo", "Basic support"] },
    { name: "pro", title: "Pro", price: "$29/mo", features: ["200 msg/mo", "Priority support", "100 min voice"] },
    { name: "enterprise", title: "Enterprise", price: "$99/mo", features: ["Unlimited", "Dedicated support", "1000 min voice"] },
  ];

  const displayPlans = plans
    ? (plans as unknown as Array<{ tier: string; name?: string; monthlyPrice?: string | null; features?: unknown }>).map((p) => ({
        name: p.tier,
        title: p.tier.charAt(0).toUpperCase() + p.tier.slice(1),
        price: p.monthlyPrice ? `$${p.monthlyPrice}/mo` : "$0",
        features: Array.isArray(p.features) ? p.features as string[] : [],
      }))
    : defaultPlans;

  if (subscriptionLoading || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  const currentTier = user?.subscriptionTier || "free";
  const isActive = subscription?.status === "active";

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold">Subscription</h1>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-3xl space-y-4">
          {/* Current Subscription Card */}
          <Card className="bg-slate-900/80 border-slate-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold capitalize">{currentTier} Plan</h2>
                <div className="flex items-center gap-1.5 mt-1">
                  {isActive ? (
                    <><CheckCircle className="w-4 h-4 text-green-400" /><span className="text-green-400 text-sm">Active</span></>
                  ) : (
                    <><AlertCircle className="w-4 h-4 text-yellow-400" /><span className="text-yellow-400 text-sm">{subscription?.status || "Inactive"}</span></>
                  )}
                </div>
              </div>
              {subscription?.currentPeriodEnd && (
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 uppercase">Renews</p>
                  <p className="text-sm font-semibold">{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
                </div>
              )}
            </div>

            {subscription?.cancelAtPeriodEnd && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 mb-3 text-xs text-yellow-300">
                Subscription will be cancelled at the end of the current billing period.
              </div>
            )}

            {showCancelConfirm && (
              <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 mb-3">
                <p className="text-sm text-slate-300 mb-2">Are you sure? You'll lose premium features at period end.</p>
                <div className="flex gap-2">
                  <Button onClick={() => cancelMutation.mutateAsync()} disabled={cancelMutation.isPending} size="sm" className="bg-red-600 hover:bg-red-700">
                    {cancelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm Cancel"}
                  </Button>
                  <Button onClick={() => setShowCancelConfirm(false)} variant="outline" size="sm" className="border-slate-700">Keep</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {currentTier !== "enterprise" && isActive && (
                <Button onClick={() => createCheckoutMutation.mutateAsync({ planId: currentTier === "free" ? "pro" : "enterprise", billingCycle: "monthly" })} disabled={createCheckoutMutation.isPending} size="sm" className="bg-blue-600 hover:bg-blue-700">
                  {createCheckoutMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : `Upgrade to ${currentTier === "free" ? "Pro" : "Enterprise"}`}
                </Button>
              )}
              {isActive && currentTier !== "free" && !showCancelConfirm && (
                <Button onClick={() => setShowCancelConfirm(true)} variant="outline" size="sm" className="border-red-500/20 text-red-300 hover:bg-red-500/10">Cancel</Button>
              )}
              <Button onClick={() => setLocation("/payments")} variant="outline" size="sm" className="border-slate-700">Payment History</Button>
            </div>
          </Card>

          {/* Plan Comparison - compact */}
          <div className="grid grid-cols-3 gap-3">
            {displayPlans.map((plan) => (
              <Card key={plan.name} className={`p-3 border ${currentTier === plan.name ? "border-blue-500 bg-blue-900/20" : "border-slate-800 bg-slate-900/50"}`}>
                <h4 className="text-sm font-bold mb-1">{plan.title}</h4>
                <p className="text-lg font-bold mb-2">{plan.price}</p>
                <ul className="space-y-1 mb-3">
                  {plan.features.map((f) => <li key={f} className="text-xs text-slate-400">{f}</li>)}
                </ul>
                {currentTier === plan.name ? (
                  <Button disabled size="sm" className="w-full text-xs">Current</Button>
                ) : (
                  <Button onClick={() => createCheckoutMutation.mutateAsync({ planId: plan.name, billingCycle: "monthly" })} disabled={createCheckoutMutation.isPending} variant="outline" size="sm" className="w-full text-xs border-slate-700">
                    Select
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
