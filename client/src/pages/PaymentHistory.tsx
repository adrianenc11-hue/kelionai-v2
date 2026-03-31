import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, ExternalLink, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function PaymentHistory() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: payments, isLoading } = trpc.subscription.getPaymentHistory.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/");
    }
  }, [loading, isAuthenticated, setLocation]);

  if (isLoading || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-xl font-bold">Payment History</h1>
        </div>
        <Button onClick={() => setLocation("/pricing")} variant="outline" size="sm" className="border-slate-700">
          View Plans
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        {payments && payments.length > 0 ? (
          <Card className="bg-slate-900/80 border-slate-800 overflow-hidden w-full max-w-4xl max-h-[70vh]">
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full">
                <thead className="sticky top-0">
                  <tr className="border-b border-slate-700 bg-slate-900">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Invoice</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 text-sm">{new Date(payment.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-400">{payment.id.slice(0, 12)}...</td>
                      <td className="px-4 py-3 text-sm font-semibold">{(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          payment.status === "paid" || payment.status === "open" ? "bg-green-500/20 text-green-300" :
                          payment.status === "draft" ? "bg-yellow-500/20 text-yellow-300" : "bg-red-500/20 text-red-300"
                        }`}>
                          {payment.status ? payment.status.charAt(0).toUpperCase() + payment.status.slice(1) : "Unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {payment.pdfUrl && (
                          <a href={payment.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs">
                            <Download className="w-3.5 h-3.5" /> PDF <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="bg-slate-900/80 border-slate-800 p-8 text-center max-w-md">
            <p className="text-slate-400 mb-4">No payments yet</p>
            <Button onClick={() => setLocation("/pricing")} className="bg-blue-600 hover:bg-blue-700">
              View Pricing Plans
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
