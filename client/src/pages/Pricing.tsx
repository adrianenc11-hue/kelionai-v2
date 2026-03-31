import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Loader2, ArrowLeft, Gift, Tag } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Pricing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [referralCode, setReferralCode] = useState("");
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [referralMessage, setReferralMessage] = useState("");

  const createCheckoutMutation = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecting to checkout...");
        window.open(data.url, "_blank");
      }
    },
    onError: (error) => {
      toast.error("Checkout failed: " + error.message);
    },
  });

  const validateReferralMutation = trpc.referral.validateCode.useMutation({
    onSuccess: (data) => {
      setReferralValid(data.valid);
      setReferralMessage(data.message);
      if (data.valid) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
  });

  const handleValidateReferral = () => {
    if (!referralCode.trim()) return;
    if (!user) {
      toast.error("Please log in to use a referral code.");
      return;
    }
    validateReferralMutation.mutateAsync({ code: referralCode.trim() });
  };

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      setLocation("/login");
      return;
    }
    if (planId === "free") {
      setLocation("/chat");
      return;
    }
    setSelectedPlan(planId);
    await createCheckoutMutation.mutateAsync({
      planId,
      billingCycle,
      referralCode: referralValid ? referralCode.trim() : undefined,
    });
    setSelectedPlan(null);
  };

  const planTiers = [
    {
      id: "free",
      name: "Free Trial",
      monthlyPrice: "$0",
      yearlyPrice: "$0",
      description: "7 days, 10 min/day",
      features: ["All AI features", "Voice chat", "Image analysis", "Code generation", "Web search", "10 min/day limit"],
      cta: "Start Free",
      highlighted: false,
    },
    {
      id: "pro",
      name: "Pro",
      monthlyPrice: "$29",
      yearlyPrice: "$290",
      yearlySavings: "Save $58",
      description: "For regular users",
      features: ["200 messages/month", "Priority AI routing", "100 min voice/month", "Full chat history", "Custom avatars", "All AI tools"],
      cta: "Subscribe",
      highlighted: true,
    },
    {
      id: "enterprise",
      name: "Enterprise",
      monthlyPrice: "$99",
      yearlyPrice: "$990",
      yearlySavings: "Save $198",
      description: "Power users",
      features: ["Unlimited messages", "Dedicated support", "1000 min voice/month", "API access", "Custom integrations", "Priority queue"],
      cta: "Subscribe",
      highlighted: false,
    },
  ];

  return (
    <div className="h-screen overflow-auto bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
          Pricing
        </h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-6 gap-6">
        {/* Billing Toggle */}
        <div className="flex items-center gap-3 bg-slate-900/80 rounded-full p-1 border border-slate-700/50">
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              billingCycle === "monthly" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle("yearly")}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
              billingCycle === "yearly" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Annual
            <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">-17%</span>
          </button>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-5 max-w-5xl w-full">
          {planTiers.map((plan) => (
            <Card
              key={plan.id}
              className={`relative p-5 flex flex-col ${
                plan.highlighted
                  ? "border-2 border-purple-500 bg-purple-900/30 transform md:scale-105"
                  : "border border-slate-700/50 bg-slate-900/50"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-0.5 rounded-full text-xs font-semibold">
                  Most Popular
                </div>
              )}

              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
              <p className="text-slate-400 text-xs mb-3">{plan.description}</p>

              <div className="mb-1">
                <span className="text-3xl font-bold">
                  {billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice}
                </span>
                {plan.id !== "free" && (
                  <span className="text-slate-400 text-sm">
                    /{billingCycle === "yearly" ? "yr" : "mo"}
                  </span>
                )}
              </div>
              {billingCycle === "yearly" && plan.yearlySavings && (
                <p className="text-green-400 text-xs mb-3 font-medium">{plan.yearlySavings}</p>
              )}
              {!(billingCycle === "yearly" && plan.yearlySavings) && <div className="mb-3" />}

              <Button
                onClick={() => handleSubscribe(plan.id)}
                disabled={selectedPlan === plan.id || createCheckoutMutation.isPending}
                className={`w-full mb-4 ${
                  plan.highlighted
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                    : ""
                }`}
                size="sm"
              >
                {selectedPlan === plan.id && createCheckoutMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  plan.cta
                )}
              </Button>

              <div className="space-y-2 flex-1">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 shrink-0" />
                    <span className="text-slate-300 text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* Referral Code Section */}
        <Card className="max-w-md w-full p-4 bg-slate-900/80 border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold">Have a referral code?</h3>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={referralCode}
              onChange={(e) => {
                setReferralCode(e.target.value.toUpperCase());
                setReferralValid(null);
                setReferralMessage("");
              }}
              placeholder="Enter code (e.g. KEL-ABC123)"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <Button
              onClick={handleValidateReferral}
              disabled={!referralCode.trim() || validateReferralMutation.isPending}
              size="sm"
              variant="outline"
              className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
            >
              {validateReferralMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
            </Button>
          </div>
          {referralMessage && (
            <p className={`text-xs mt-2 ${referralValid ? "text-green-400" : "text-red-400"}`}>
              {referralMessage}
            </p>
          )}
        </Card>

        {/* Refund Policy */}
        <div className="max-w-2xl text-center text-xs text-slate-500 space-y-1">
          <p><strong className="text-slate-400">Refund Policy:</strong> Monthly subscriptions are non-refundable.</p>
          <p>Annual subscriptions: refund of 11 months available within the first 3 months (15 business days processing).</p>
          <p>After 3 completed months, annual subscriptions are non-refundable.</p>
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-800/50 py-2 text-center text-xs text-slate-500">
        Test with card 4242 4242 4242 4242. Upgrade anytime.
      </footer>
    </div>
  );
}
