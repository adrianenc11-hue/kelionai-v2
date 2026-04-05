import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Loader2, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function Pricing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const { data: plans, isLoading } = trpc.subscription.getPlans.useQuery();
  const createCheckoutMutation = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (error) => {
      console.error("Checkout failed:", error);
    },
  });

  const handleSubscribe = async (planId: string) => {
    if (!user) {
      setLocation("/login");
      return;
    }
    
    // Contul free nu are nevoie de procesator de plată (Stripe Checkout)
    // Direcționează utilizatorul direct către chat 
    if (planId === "free") {
      setLocation("/chat");
      return;
    }
    
    setSelectedPlan(planId);
    await createCheckoutMutation.mutateAsync({
      planId,
      billingCycle: "monthly",
    });
    setSelectedPlan(null);
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  const planTiers = [
    {
      name: "Free",
      price: "$0",
      description: "Getting started",
      features: ["20 messages/month", "All AI models", "10 min voice/month"],
      cta: "Get Started",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "$29",
      period: "/mo",
      description: "For regular users",
      features: ["200 messages/month", "Priority routing", "100 min voice/month", "Chat history", "Custom avatars"],
      cta: "Subscribe",
      highlighted: true,
    },
    {
      name: "Enterprise",
      price: "$99",
      period: "/mo",
      description: "Power users",
      features: ["Unlimited messages", "Dedicated support", "1000 min voice/month", "API access", "Custom integrations"],
      cta: "Contact Sales",
      highlighted: false,
    },
  ];

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
          Pricing
        </h1>
      </header>

      {/* Pricing Cards - centered, no scroll */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className="grid md:grid-cols-3 gap-5 max-w-5xl w-full">
          {planTiers.map((plan) => (
            <Card
              key={plan.name}
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

              <div className="mb-4">
                <span className="text-3xl font-bold">{plan.price}</span>
                {plan.period && <span className="text-slate-400 text-sm">{plan.period}</span>}
              </div>

              <Button
                onClick={() => handleSubscribe(plan.name.toLowerCase())}
                disabled={selectedPlan === plan.name.toLowerCase() || createCheckoutMutation.isPending}
                className={`w-full mb-4 ${
                  plan.highlighted
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                    : ""
                }`}
                size="sm"
              >
                {selectedPlan === plan.name.toLowerCase() && createCheckoutMutation.isPending ? (
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
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-800/50 py-2 text-center text-xs text-slate-500">
        Free to start. No credit card required. Upgrade anytime.
      </footer>
    </div>
  );
}
