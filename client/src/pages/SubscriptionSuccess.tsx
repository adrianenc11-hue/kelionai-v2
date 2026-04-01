import { useEffect } from "react";
import { Link } from "wouter";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SubscriptionSuccess() {
  useEffect(() => {
    document.title = "Payment Successful - KelionAI";
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle className="w-12 h-12 text-emerald-400" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-white">Payment Successful!</h1>
        <p className="text-slate-400 text-lg">
          Your subscription is now active. Thank you for choosing KelionAI!
        </p>
        
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <p className="text-slate-300 text-sm">
            Your account has been upgraded. All premium features are now available.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-4">
          <Link href="/chat">
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Start Chatting
            </Button>
          </Link>
          <Link href="/subscription">
            <Button variant="outline" className="w-full border-slate-600 text-slate-300 hover:bg-slate-800">
              View Subscription
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
