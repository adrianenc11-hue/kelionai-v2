import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle, ArrowLeft, Gift, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function SubscriptionManagement() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/");
    }
  }, [loading, isAuthenticated, setLocation]);

  const { data: subscription, isLoading: subscriptionLoading } = trpc.subscription.getSubscriptionStatus.useQuery(
    undefined, { enabled: isAuthenticated }
  );

  const { data: myRefunds } = trpc.refund.myRefunds.useQuery(undefined, { enabled: isAuthenticated });
  const { data: myReferrals } = trpc.referral.myReferrals.useQuery(undefined, { enabled: isAuthenticated });

  const cancelMutation = trpc.subscription.cancelSubscription.useMutation({
    onSuccess: () => {
      setShowCancelConfirm(false);
      toast.success("Subscription will be cancelled at end of billing period.");
    },
  });

  const createCheckoutMutation = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecting to checkout...");
        window.open(data.url, "_blank");
      }
    },
  });

  const refundMutation = trpc.refund.requestRefund.useMutation({
    onSuccess: (data) => {
      setShowRefundConfirm(false);
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

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
    <div className="h-screen overflow-auto bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold">Subscription</h1>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center px-4 sm:px-6 py-6 gap-4">
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

            {/* Cancel Confirmation */}
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

            {/* Refund Request */}
            {showRefundConfirm && (
              <div className="bg-orange-900/20 border border-orange-500/20 rounded-lg p-3 mb-3">
                <p className="text-sm text-slate-300 mb-1 font-semibold">Request Refund</p>
                <p className="text-xs text-slate-400 mb-2">
                  Monthly: non-refundable. Annual: 11 months refunded if within first 3 months (15 business days). After 3 months: no refund.
                </p>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Reason for refund (optional)"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-slate-500 mb-2 resize-none"
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => refundMutation.mutateAsync({ reason: refundReason || undefined })}
                    disabled={refundMutation.isPending}
                    size="sm"
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {refundMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Submit Refund Request"}
                  </Button>
                  <Button onClick={() => setShowRefundConfirm(false)} variant="outline" size="sm" className="border-slate-700">Cancel</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {currentTier !== "enterprise" && isActive && (
                <Button
                  onClick={() => createCheckoutMutation.mutateAsync({ planId: currentTier === "free" ? "pro" : "enterprise", billingCycle: "monthly" })}
                  disabled={createCheckoutMutation.isPending}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {createCheckoutMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : `Upgrade to ${currentTier === "free" ? "Pro" : "Enterprise"}`}
                </Button>
              )}
              {isActive && currentTier !== "free" && !showCancelConfirm && !showRefundConfirm && (
                <>
                  <Button onClick={() => setShowCancelConfirm(true)} variant="outline" size="sm" className="border-red-500/20 text-red-300 hover:bg-red-500/10">
                    Cancel
                  </Button>
                  <Button onClick={() => setShowRefundConfirm(true)} variant="outline" size="sm" className="border-orange-500/20 text-orange-300 hover:bg-orange-500/10">
                    <RefreshCw className="w-3 h-3 mr-1" /> Request Refund
                  </Button>
                </>
              )}
              <Button onClick={() => setLocation("/payments")} variant="outline" size="sm" className="border-slate-700">Payment History</Button>
              <Button onClick={() => setLocation("/pricing")} variant="outline" size="sm" className="border-slate-700">View Plans</Button>
            </div>
          </Card>

          {/* Refund History */}
          {myRefunds && myRefunds.length > 0 && (
            <Card className="bg-slate-900/80 border-slate-800 p-4">
              <h3 className="text-sm font-bold mb-3">Refund Requests</h3>
              <div className="space-y-2">
                {myRefunds.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3">
                    <div>
                      <p className="text-sm">{r.billingCycle} subscription</p>
                      <p className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</p>
                      {r.adminNote && <p className="text-xs text-slate-500 mt-1">{r.adminNote}</p>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      r.status === "approved" || r.status === "completed" ? "bg-green-500/20 text-green-400" :
                      r.status === "denied" ? "bg-red-500/20 text-red-400" :
                      "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {r.status}
                      {r.refundAmount && r.status !== "denied" ? ` - $${r.refundAmount}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Referrals Section */}
          <Card className="bg-slate-900/80 border-slate-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Gift className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold">My Referrals</h3>
            </div>
            {myReferrals && myReferrals.length > 0 ? (
              <div className="space-y-2">
                {myReferrals.map((ref: any) => (
                  <div key={ref.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-mono">{ref.code}</p>
                      <p className="text-xs text-slate-400">Sent to {ref.recipientEmail}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      ref.usedBy ? "bg-green-500/20 text-green-400" :
                      new Date() > new Date(ref.expiresAt) ? "bg-red-500/20 text-red-400" :
                      "bg-blue-500/20 text-blue-400"
                    }`}>
                      {ref.usedBy ? (ref.bonusApplied ? "Used (+5 days)" : "Used") :
                       new Date() > new Date(ref.expiresAt) ? "Expired" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No referrals sent yet. Share your referral code to earn 5 bonus days!</p>
            )}
          </Card>

          {/* Plan Comparison */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: "free", title: "Free Trial", price: "$0", features: ["7 days", "10 min/day", "All features"] },
              { name: "pro", title: "Pro", price: "$29/mo", yearlyPrice: "$290/yr", features: ["200 msg/mo", "Priority", "100 min voice"] },
              { name: "enterprise", title: "Enterprise", price: "$99/mo", yearlyPrice: "$990/yr", features: ["Unlimited", "Dedicated", "1000 min voice"] },
            ].map((plan) => (
              <Card key={plan.name} className={`p-3 border ${currentTier === plan.name ? "border-blue-500 bg-blue-900/20" : "border-slate-800 bg-slate-900/50"}`}>
                <h4 className="text-sm font-bold mb-1">{plan.title}</h4>
                <p className="text-lg font-bold mb-2">{plan.price}</p>
                {plan.yearlyPrice && <p className="text-xs text-slate-400 -mt-2 mb-2">or {plan.yearlyPrice}</p>}
                <ul className="space-y-1 mb-3">
                  {plan.features.map((f) => <li key={f} className="text-xs text-slate-400">{f}</li>)}
                </ul>
                {currentTier === plan.name ? (
                  <Button disabled size="sm" className="w-full text-xs">Current</Button>
                ) : (
                  <Button onClick={() => setLocation("/pricing")} variant="outline" size="sm" className="w-full text-xs border-slate-700">
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
