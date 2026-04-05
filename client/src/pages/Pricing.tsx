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

  // Detectează dacă utilizatorul a expirat (abonamentul a fost anulat sau restanțier)
  const isExpired =
    user &&
    (user.subscriptionStatus === "cancelled" || user.subscriptionStatus === "past_due");

  const handleSubscribe = async (planId: string) => {
    if (planId === "free") {
      // Butonul Free → register dacă nu e autentificat, altfel direct la chat
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

  // Filtrează planurile: dacă utilizatorul a expirat, ascunde planul Free
  const visiblePlans = (plans || []).filter((plan) => {
    if (isExpired && plan.tier === "free") return false;
    return true;
  });

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

      {/* Banner expirare */}
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
        {visiblePlans.length === 0 ? (
          <div className="text-slate-400 text-center">
            <p>Nu există planuri disponibile momentan.</p>
          </div>
        ) : (
          <div
            className={`grid gap-5 max-w-5xl w-full ${
              visiblePlans.length === 1
                ? "max-w-sm"
                : visiblePlans.length === 2
                ? "md:grid-cols-2 max-w-3xl"
                : "md:grid-cols-3"
            }`}
          >
            {visiblePlans.map((plan) => {
              const isHighlighted = plan.tier === "pro";
              const isFreeTier = plan.tier === "free";
              const features: string[] = Array.isArray(plan.features)
                ? (plan.features as string[])
                : [];

              return (
                <Card
                  key={plan.id}
                  className={`relative p-5 flex flex-col ${
                    isHighlighted
                      ? "border-2 border-purple-500 bg-purple-900/30 transform md:scale-105"
                      : "border border-slate-700/50 bg-slate-900/50"
                  }`}
                >
                  {isHighlighted && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-0.5 rounded-full text-xs font-semibold">
                      Cel mai popular
                    </div>
                  )}

                  <h3 className="text-lg font-bold mb-1 capitalize">{plan.name}</h3>
                  <p className="text-slate-400 text-xs mb-3">
                    {isFreeTier ? "Testează aplicația" : plan.tier === "enterprise" ? "Utilizatori Power" : "Pentru utilizatori activi"}
                  </p>

                  <div className="mb-4">
                    <span className="text-3xl font-bold">
                      {isFreeTier ? "$0" : `$${Number(plan.monthlyPrice || 0).toFixed(0)}`}
                    </span>
                    {!isFreeTier && <span className="text-slate-400 text-sm">/lună</span>}
                  </div>

                  <Button
                    onClick={() => handleSubscribe(plan.tier)}
                    disabled={selectedPlan === plan.tier || createCheckoutMutation.isPending}
                    className={`w-full mb-4 ${
                      isHighlighted
                        ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                        : isFreeTier
                        ? "bg-blue-600 hover:bg-blue-700"
                        : ""
                    }`}
                    size="sm"
                  >
                    {selectedPlan === plan.tier && createCheckoutMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isFreeTier ? (
                      user ? "Intră în Chat" : "Încearcă Gratis"
                    ) : (
                      "Abonează-te"
                    )}
                  </Button>

                  <div className="space-y-2 flex-1">
                    {plan.messagesPerMonth && (
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-400 shrink-0" />
                        <span className="text-slate-300 text-sm">
                          {plan.messagesPerMonth === -1 ? "Mesaje nelimitate" : `${plan.messagesPerMonth} mesaje/lună`}
                        </span>
                      </div>
                    )}
                    {plan.voiceMinutesPerMonth && (
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-400 shrink-0" />
                        <span className="text-slate-300 text-sm">
                          {plan.voiceMinutesPerMonth === -1 ? "Voce nelimitată" : `${plan.voiceMinutesPerMonth} min voce/lună`}
                        </span>
                      </div>
                    )}
                    {features.map((feature: string) => (
                      <div key={feature} className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-400 shrink-0" />
                        <span className="text-slate-300 text-sm">{feature}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-800/50 py-2 text-center text-xs text-slate-500">
        {isExpired
          ? "Reactivează-ți contul cu un plan plătit."
          : "Gratuit pentru a începe. Nu se cere card. Upgrade oricând."}
      </footer>
    </div>
  );
}
