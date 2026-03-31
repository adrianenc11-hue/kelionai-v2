import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Zap, Shield, Globe } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    setLocation("/chat");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Navigation */}
      <nav className="border-b border-purple-500/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            KelionAI
          </div>
          <Button onClick={() => (window.location.href = getLoginUrl())} variant="default">
            Sign In
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <h1 className="text-5xl sm:text-6xl font-bold mb-6 bg-gradient-to-r from-purple-200 to-pink-200 bg-clip-text text-transparent">
            Multi-AI Chat Platform
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Connect to multiple advanced AI models in one seamless interface. Switch between GPT-4, Gemini, Claude, Groq, and DeepSeek instantly.
          </p>
          <Button
            onClick={() => (window.location.href = getLoginUrl())}
            size="lg"
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          >
            Get Started Free
          </Button>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-6 backdrop-blur-sm">
            <MessageSquare className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="font-semibold mb-2">Multi-AI Routing</h3>
            <p className="text-sm text-gray-300">Intelligent routing between GPT-4, Gemini, Groq, Claude, and DeepSeek</p>
          </div>

          <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-6 backdrop-blur-sm">
            <Zap className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="font-semibold mb-2">Voice Interaction</h3>
            <p className="text-sm text-gray-300">Real-time speech-to-text and text-to-speech capabilities</p>
          </div>

          <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-6 backdrop-blur-sm">
            <Shield className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="font-semibold mb-2">Secure & Private</h3>
            <p className="text-sm text-gray-300">Enterprise-grade security with end-to-end encryption</p>
          </div>

          <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-6 backdrop-blur-sm">
            <Globe className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="font-semibold mb-2">Multi-Language</h3>
            <p className="text-sm text-gray-300">Support for multiple languages and locales</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-purple-500/20 mt-20 py-8 text-center text-gray-400">
        <p>&copy; 2026 KelionAI. All rights reserved.</p>
      </footer>
    </div>
  );
}
