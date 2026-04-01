import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";

import { useTranslation } from 'react-i18next';

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [activeAvatar, setActiveAvatar] = useState<"kelion" | "kira">("kelion");
  const { t } = useTranslation();

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
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
      </div>
    );
  }

  if (isAuthenticated && user) return null;

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-slate-800/50 bg-slate-950/90 backdrop-blur-md shrink-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold text-blue-400">KelionAI</div>
            <span className="text-xs bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded-full">v4.0</span>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setLocation("/contact")} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              {t('nav.contact')}
            </Button>
            <Button onClick={() => setLocation("/pricing")} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              {t('nav.pricing')}
            </Button>

            <Button onClick={() => { const url = getLoginUrl(); if (url && url !== '#') window.location.href = url; }} className="bg-blue-600 hover:bg-blue-700">
              {t('nav.signIn')}
            </Button>
          </div>
        </div>
      </nav>

      {/* Main Content - Single Screen, No Scroll */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center max-w-7xl w-full">
          {/* Left: Text Content */}
          <div className="text-center lg:text-left">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
              <span className="text-white">{t('home.title').split(' ').slice(0, 2).join(' ')} </span>
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">{t('home.title').split(' ').slice(2, 3).join(' ')}</span>
              <br />
              <span className="text-white">{t('home.title').split(' ').slice(3).join(' ')}</span>
            </h1>
            <p className="text-base sm:text-lg text-slate-300 mb-3 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              {t('home.subtitle')}
            </p>
            <p className="text-sm text-slate-400 mb-6 max-w-xl mx-auto lg:mx-0">
              {t('home.description')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Button
                onClick={() => { const url = getLoginUrl(); if (url && url !== '#') window.location.href = url; }}
                size="lg"
                className="bg-blue-600 hover:bg-blue-700 text-base px-6 py-5 gap-2"
              >
                {t('home.getStarted')} <ArrowRight className="w-5 h-5" />
              </Button>
              <Button
                onClick={() => setLocation("/pricing")}
                size="lg"
                variant="outline"
                className="border-slate-700 text-base px-6 py-5"
              >
                {t('home.viewPlans')}
              </Button>
            </div>
          </div>

          {/* Right: Live Avatar */}
          <div className="flex flex-col items-center gap-3">
            {/* Avatar selector - LEFT and RIGHT buttons */}
            <div className="flex items-center gap-4 w-full">
              <button
                onClick={() => setActiveAvatar("kelion")}
                className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  activeAvatar === "kelion"
                    ? "bg-blue-600 text-white border-blue-500"
                    : "bg-slate-900/80 text-slate-400 hover:text-white border-slate-700/50"
                }`}
              >
                Kelion
              </button>
              <button
                onClick={() => setActiveAvatar("kira")}
                className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  activeAvatar === "kira"
                    ? "bg-purple-600 text-white border-purple-500"
                    : "bg-slate-900/80 text-slate-400 hover:text-white border-slate-700/50"
                }`}
              >
                Kira
              </button>
            </div>

            {/* 3D Avatar */}
            <div className="relative w-full h-[280px] sm:h-[320px] lg:h-[380px] rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/50">
              <Avatar3D
                character={activeAvatar}
                emotion="happy"
                isAnimating={true}
              />
              {/* Status badge */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur px-3 py-1.5 rounded-full flex items-center gap-2 border border-slate-700/50">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-slate-300">
                  {activeAvatar === "kelion" ? "Kelion" : "Kira"} {t('home.online')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - minimal */}
      <footer className="border-t border-slate-800/50 py-2 shrink-0">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center text-xs text-slate-500">
          <span>&copy; 2026 KelionAI</span>
          <a href="mailto:contact@kelionai.app" className="hover:text-white transition-colors">contact@kelionai.app</a>
        </div>
      </footer>
    </div>
  );
}
