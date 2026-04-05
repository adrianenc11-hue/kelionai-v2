import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function Pricing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Detectează dacă utilizatorul a expirat (a consumat perioada free sau abonamentul a expirat)
  const isExpired =
    user &&
    (user.subscriptionStatus === "cancelled" ||
      user.subscriptionStatus === "past_due" ||
      (user.subscriptionTier === "free" && (user as any).freeTrialExpired === true));

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
    if (planId === "free") {
      // Butonul Free → duce la register dacă nu e autentificat, altfel direct la chat
      if (!user) {
        window.location.href = "/login?plan=free&mode=register";
      } else {
        window.location.href = "/chat";
      }
      return;
    }

    if (!user) {
      window.location.href = `/login?plan=${planId}`;
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

  // Toate planurile disponibile
  const allPlanTiers = [
    {
      id: "free",
      name: "Free",
      price: "$0",
      description: "Testează aplicația",
      features: ["20 mesaje/lună", "Toate modelele AI", "10 min voce/lună"],
      cta: user ? "Intră în Chat" : "Încearcă Gratis",
      highlighted: false,
      isFreeTier: true,
    },
    {
      id: "pro",
      name: "Pro",
      price: "$29",
      period: "/lună",
      description: "Pentru utilizatori activi",
      features: ["200 mesaje/lună", "Prioritate routing", "100 min voce/lună", "Istoric chat", "Avatare personalizate"],
      cta: "Abonează-te",
      highlighted: true,
      isFreeTier: false,
    },
    {
      id: "enterprise",
      name: "Enterprise",
      price: "$99",
      period: "/lună",
      description: "Utilizatori Power",
      features: ["Mesaje nelimitate", "Suport dedicat", "1000 min voce/lună", "Acces API", "Integrări custom"],
      cta: "Contactează Sales",
      highlighted: false,
      isFreeTier: false,
    },
  ];

  // Dacă utilizatorul a expirat, ascunde planul Free — forțează upgrade
  const planTiers = isExpired
    ? allPlanTiers.filter((p) => !p.isFreeTier)
    : allPlanTiers;

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button
          onClick={() => (user ? (window.location.href = "/chat") : (window.location.href = "/"))}
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-white gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Înapoi
        </Button>
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
          Planuri & Prețuri
        </h1>
      </header>

      {/* Banner de expirare - vizibil doar dacă perioada free s-a terminat */}
      {isExpired && (
        <div className="shrink-0 bg-amber-900/40 border-b border-amber-700/50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-amber-300 text-sm">
            <strong>Perioada ta de test a expirat.</strong> Alege un plan plătit pentru a continua să folosești KelionAI.
          </p>
        </div>
      )}

      {/* Pricing Cards */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className={`grid gap-5 max-w-5xl w-full ${isExpired ? "md:grid-cols-2 max-w-3xl" : "md:grid-cols-3"}`}>
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
                  Cel mai popular
                </div>
              )}

              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
              <p className="text-slate-400 text-xs mb-3">{plan.description}</p>

              <div className="mb-4">
                <span className="text-3xl font-bold">{plan.price}</span>
                {plan.period && <span className="text-slate-400 text-sm">{plan.period}</span>}
              </div>

              <Button
                onClick={() => handleSubscribe(plan.id)}
                disabled={selectedPlan === plan.id || createCheckoutMutation.isPending}
                className={`w-full mb-4 ${
                  plan.highlighted
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                    : plan.isFreeTier
                    ? "bg-blue-600 hover:bg-blue-700"
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
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-800/50 py-2 text-center text-xs text-slate-500">
        {isExpired
          ? "Reactivează-ți contul cu un plan plătit. Niciun angajament."
          : "Gratuit pentru a începe. Nu se cere card. Upgrade oricând."}
      </footer>
    </div>
  );
}
