import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Mic, Eye, Brain, Globe, Shield, Heart, ArrowRight, Mail } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [activeAvatar, setActiveAvatar] = useState<"kelion" | "kira">("kelion");

  useEffect(() => {
    if (isAuthenticated && user && !loading) {
      setLocation("/chat");
    }
  }, [isAuthenticated, user, loading, setLocation]);

  // Alternate avatars every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveAvatar((prev) => (prev === "kelion" ? "kira" : "kelion"));
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950" role="status" aria-label="Loading">
        <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
      </div>
    );
  }

  if (isAuthenticated && user) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white" role="main" aria-label="KelionAI Home Page">
      {/* Navigation */}
      <nav className="border-b border-slate-800/50 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50" role="navigation" aria-label="Main navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold text-blue-400">KelionAI</div>
            <span className="text-xs bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded-full">v4.0</span>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setLocation("/contact")} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              Contact
            </Button>
            <Button onClick={() => setLocation("/pricing")} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              Pricing
            </Button>
            <Button onClick={() => { const url = getLoginUrl(); if (url && url !== '#') window.location.href = url; }} className="bg-blue-600 hover:bg-blue-700">
              Sign In
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section with Live Avatars */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left: Text Content */}
            <div className="text-center lg:text-left">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                <span className="text-white">AI That </span>
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Understands</span>
                <br />
                <span className="text-white">Everyone</span>
              </h1>
              <p className="text-lg sm:text-xl text-slate-300 mb-4 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Meet <strong className="text-blue-400">Kelion</strong> and <strong className="text-purple-400">Kira</strong> — AI assistants designed for everyone. Children, visually impaired users, professionals, and anyone in between.
              </p>
              <p className="text-base text-slate-400 mb-8 max-w-xl mx-auto lg:mx-0">
                Voice-first. Accessible. Adaptive. They speak your language and match your level.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Button
                  onClick={() => { const url = getLoginUrl(); if (url && url !== '#') window.location.href = url; }}
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-6 gap-2"
                  aria-label="Get started with KelionAI for free"
                >
                  Get Started Free <ArrowRight className="w-5 h-5" />
                </Button>
                <Button
                  onClick={() => setLocation("/pricing")}
                  size="lg"
                  variant="outline"
                  className="border-slate-700 text-lg px-8 py-6"
                >
                  View Plans
                </Button>
              </div>
            </div>

            {/* Right: Live Avatars */}
            <div className="relative h-[400px] lg:h-[500px]" aria-label={`${activeAvatar === "kelion" ? "Kelion" : "Kira"} AI avatar`}>
              {/* Avatar selector pills */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-900/80 backdrop-blur rounded-full p-1">
                <button
                  onClick={() => setActiveAvatar("kelion")}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    activeAvatar === "kelion"
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                  aria-label="Show Kelion avatar"
                >
                  Kelion
                </button>
                <button
                  onClick={() => setActiveAvatar("kira")}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    activeAvatar === "kira"
                      ? "bg-purple-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                  aria-label="Show Kira avatar"
                >
                  Kira
                </button>
              </div>

              {/* 3D Avatar */}
              <div className="w-full h-full rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/50">
                <Avatar3D
                  character={activeAvatar}
                  emotion="happy"
                  isAnimating={true}
                />
              </div>

              {/* Status badge */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur px-4 py-2 rounded-full flex items-center gap-2 border border-slate-700/50">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm text-slate-300">
                  {activeAvatar === "kelion" ? "Kelion" : "Kira"} is online
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-slate-900/30 border-y border-slate-800/50 py-16 lg:py-20" aria-label="Features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Built for Everyone</h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              From children to professionals, from visually impaired to tech experts — KelionAI adapts to you.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-blue-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-blue-600/10 flex items-center justify-center mb-4">
                <Mic className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Voice First</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Speak naturally. Kelion and Kira listen, understand, and respond with real voices powered by ElevenLabs.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-purple-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-purple-600/10 flex items-center justify-center mb-4">
                <Eye className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Vision for Everyone</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                GPT-5.4 vision describes the world for visually impaired users. Point your camera and ask what you see.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-green-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-green-600/10 flex items-center justify-center mb-4">
                <Brain className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Adaptive Intelligence</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Detects your communication level and adapts. Simple for children, technical for experts. Never condescending.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-yellow-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-yellow-600/10 flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-yellow-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Honest AI</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Never lies, never hallucinates. If it doesn't know, it says so. Confidence indicators on every response.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-pink-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-pink-600/10 flex items-center justify-center mb-4">
                <Globe className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Multi-Language</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Auto-detects your language and responds naturally. Romanian, English, Spanish, French, and many more.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl p-6 hover:border-red-500/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-red-600/10 flex items-center justify-center mb-4">
                <Heart className="w-6 h-6 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Voice Cloning</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Clone your voice in 30 seconds. The AI responds with YOUR voice. Just say "clone my voice" in chat.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 lg:py-20" aria-label="How it works">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-12">Start in Seconds</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            <div>
              <div className="w-14 h-14 rounded-full bg-blue-600/20 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-blue-400">1</div>
              <h3 className="font-semibold mb-2">Sign In</h3>
              <p className="text-sm text-slate-400">One click with Manus OAuth. No forms, no passwords to remember.</p>
            </div>
            <div>
              <div className="w-14 h-14 rounded-full bg-purple-600/20 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-purple-400">2</div>
              <h3 className="font-semibold mb-2">Choose Your AI</h3>
              <p className="text-sm text-slate-400">Pick Kelion (analytical) or Kira (creative). Switch anytime.</p>
            </div>
            <div>
              <div className="w-14 h-14 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-green-400">3</div>
              <h3 className="font-semibold mb-2">Talk or Type</h3>
              <p className="text-sm text-slate-400">Use your voice or keyboard. The AI adapts to you, not the other way around.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 border-y border-slate-800/50 py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to meet your AI assistant?</h2>
          <p className="text-lg text-slate-400 mb-8">Free to start. No credit card required.</p>
          <Button
            onClick={() => { const url = getLoginUrl(); if (url && url !== '#') window.location.href = url; }}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700 text-lg px-10 py-6 gap-2"
          >
            Get Started <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8" role="contentinfo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-slate-500">&copy; 2026 KelionAI. All rights reserved.</p>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <button onClick={() => setLocation("/contact")} className="hover:text-white transition-colors flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> Contact
            </button>
            <button onClick={() => setLocation("/pricing")} className="hover:text-white transition-colors">
              Pricing
            </button>
            <a href="mailto:contact@kelionai.app" className="hover:text-white transition-colors">
              contact@kelionai.app
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
