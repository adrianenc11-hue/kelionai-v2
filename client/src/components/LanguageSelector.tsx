import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '@/i18n';
import { Globe } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';

export function LanguageSelector({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { isAuthenticated } = useAuth();
  const updateLanguage = trpc.profile.updateLanguage.useMutation();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = supportedLanguages.find(l => l.code === i18n.language) || supportedLanguages[0];

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    setOpen(false);
    // Save preference to backend if authenticated
    if (isAuthenticated) {
      updateLanguage.mutate({ language: code });
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        title="Language"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden sm:inline">{current.code.toUpperCase()}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[140px] max-h-[300px] overflow-y-auto py-1">
          {supportedLanguages.map(lang => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-700 transition-colors ${
                lang.code === i18n.language ? 'text-cyan-400 bg-gray-700/50' : 'text-white/80'
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
