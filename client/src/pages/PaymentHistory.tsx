import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";

export default function PaymentHistory() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const { data: payments, isLoading } = trpc.subscription.getPaymentHistory.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  if (!isAuthenticated) {
    setLocation("/");
    return null;
  }

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Payment History</h1>
            <p className="text-gray-400 mt-2">View and download your invoices</p>
          </div>
          <Button onClick={() => setLocation("/pricing")} variant="outline">
            Manage Subscription
          </Button>
        </div>

        {/* Payments Table */}
        {payments && payments.length > 0 ? (
          <Card className="bg-purple-900/20 border border-purple-500/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-purple-500/20 bg-purple-900/30">
                    <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Invoice ID</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Amount</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/20">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-purple-900/20 transition-colors">
                      <td className="px-6 py-4 text-sm">
                        {new Date(payment.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-purple-300">
                        {payment.id.slice(0, 12)}...
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold">
                        {(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            payment.status === "paid" || payment.status === "open"
                              ? "bg-green-500/20 text-green-300"
                              : payment.status === "draft"
                              ? "bg-yellow-500/20 text-yellow-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {payment.status ? payment.status.charAt(0).toUpperCase() + payment.status.slice(1) : "Unknown"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {payment.pdfUrl && (
                          <a
                            href={payment.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Download
                            <ExternalLink className="w-3 h-3" />
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
          <Card className="bg-purple-900/20 border border-purple-500/20 p-8 text-center">
            <p className="text-gray-400 mb-4">No payments yet</p>
            <Button onClick={() => setLocation("/pricing")}>
              View Pricing Plans
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
