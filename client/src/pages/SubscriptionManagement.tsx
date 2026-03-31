import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

export default function SubscriptionManagement() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  if (!isAuthenticated) {
    setLocation("/");
    return null;
  }

  const { data: subscription, isLoading: subscriptionLoading } = trpc.subscription.getSubscriptionStatus.useQuery();
  const { data: plans, isLoading: plansLoading } = trpc.subscription.getPlans.useQuery();

  const cancelMutation = trpc.subscription.cancelSubscription.useMutation({
    onSuccess: () => {
      setShowCancelConfirm(false);
      // Invalidate subscription status to refresh
      trpc.useUtils().subscription.getSubscriptionStatus.invalidate();
    },
  });

  const createCheckoutMutation = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
  });

  const isLoading = subscriptionLoading || plansLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const currentTier = user?.subscriptionTier || "free";
  const isActive = subscription?.status === "active";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2">Subscription Management</h1>
        <p className="text-gray-400">Manage your current subscription and billing</p>
      </div>

      {/* Current Subscription */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <Card className="bg-purple-900/20 border border-purple-500/20 p-8 mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold capitalize mb-2">{currentTier} Plan</h2>
              <div className="flex items-center gap-2">
                {isActive ? (
                  <>
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <span className="text-green-400">Active</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-yellow-400" />
                    <span className="text-yellow-400">{subscription?.status || "Inactive"}</span>
                  </>
                )}
              </div>
            </div>
            {subscription?.currentPeriodEnd && (
              <div className="text-right">
                <p className="text-sm text-gray-400">Renews on</p>
                <p className="text-lg font-semibold">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {subscription?.cancelAtPeriodEnd && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
              <p className="text-yellow-300">
                Your subscription will be cancelled at the end of the current billing period.
              </p>
            </div>
          )}

          <div className="flex gap-4">
            {currentTier !== "enterprise" && isActive && (
              <Button
                onClick={() => createCheckoutMutation.mutateAsync({
                  planId: currentTier === "free" ? "pro" : "enterprise",
                  billingCycle: "monthly",
                })}
                disabled={createCheckoutMutation.isPending}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {createCheckoutMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  `Upgrade to ${currentTier === "free" ? "Pro" : "Enterprise"}`
                )}
              </Button>
            )}

            {isActive && currentTier !== "free" && (
              <Button
                onClick={() => setShowCancelConfirm(true)}
                variant="outline"
                className="border-red-500/20 text-red-300 hover:bg-red-500/10"
              >
                Cancel Subscription
              </Button>
            )}

            <Button onClick={() => setLocation("/payments")} variant="outline">
              View Payment History
            </Button>
          </div>
        </Card>

        {/* Cancel Confirmation */}
        {showCancelConfirm && (
          <Card className="bg-red-900/20 border border-red-500/20 p-6 mb-8">
            <h3 className="text-lg font-bold mb-4">Cancel Subscription?</h3>
            <p className="text-gray-300 mb-6">
              Your subscription will be cancelled at the end of the current billing period. You'll lose access to premium features.
            </p>
            <div className="flex gap-4">
              <Button
                onClick={() => cancelMutation.mutateAsync()}
                disabled={cancelMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Confirm Cancellation"
                )}
              </Button>
              <Button onClick={() => setShowCancelConfirm(false)} variant="outline">
                Keep Subscription
              </Button>
            </div>
          </Card>
        )}

        {/* Plan Comparison */}
        <div className="mt-12">
          <h3 className="text-2xl font-bold mb-6">Available Plans</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: "free",
                title: "Free",
                price: "$0",
                features: ["20 messages/month", "Basic support"],
              },
              {
                name: "pro",
                title: "Pro",
                price: "$29",
                period: "/month",
                features: ["200 messages/month", "Priority support", "100 min voice/month"],
              },
              {
                name: "enterprise",
                title: "Enterprise",
                price: "$99",
                period: "/month",
                features: ["Unlimited messages", "Dedicated support", "1000 min voice/month"],
              },
            ].map((plan) => (
              <Card
                key={plan.name}
                className={`p-6 border ${
                  currentTier === plan.name
                    ? "border-purple-500 bg-purple-900/30"
                    : "border-purple-500/20 bg-purple-900/10"
                }`}
              >
                <h4 className="text-lg font-bold mb-2">{plan.title}</h4>
                <div className="mb-4">
                  <span className="text-2xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-gray-400">{plan.period}</span>}
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-sm text-gray-300">
                      • {feature}
                    </li>
                  ))}
                </ul>
                {currentTier === plan.name ? (
                  <Button disabled className="w-full">
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      createCheckoutMutation.mutateAsync({
                        planId: plan.name,
                        billingCycle: "monthly",
                      })
                    }
                    disabled={createCheckoutMutation.isPending}
                    variant="outline"
                    className="w-full"
                  >
                    {createCheckoutMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Select Plan"
                    )}
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
