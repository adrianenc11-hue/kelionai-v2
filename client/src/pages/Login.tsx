import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function Login() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [isRegister] = useRoute("/register");
  const [isLogin, setIsLogin] = useState(!isRegister);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { email, password };
      if (!isLogin && name) body.name = name;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('common.error'));
        return;
      }

      toast.success(isLogin ? t('auth.welcomeBack') + "!" : t('auth.createAccount') + "!");

      // Redirect to chat
      navigate("/chat");
      // Force reload to update auth state
      window.location.href = "/chat";
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md bg-gray-800/80 border-gray-700 backdrop-blur-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-white">
            {isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}
          </CardTitle>
          <CardDescription className="text-gray-400">
            {isLogin
              ? t('auth.signInSubtitle')
              : t('auth.createAccountSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-300">
                  {t('auth.name')}
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t('auth.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-gray-700/50 border-gray-600 text-white placeholder:text-gray-500"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300">
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-gray-700/50 border-gray-600 text-white placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                {t('auth.password')}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="bg-gray-700/50 border-gray-600 text-white placeholder:text-gray-500"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold"
            >
              {loading
                ? t('common.loading')
                : isLogin
                ? t('auth.signIn')
                : t('auth.register')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-cyan-400 hover:text-cyan-300 text-sm"
            >
              {isLogin
                ? t('auth.noAccount')
                : t('auth.hasAccount')}
            </button>
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-gray-500 hover:text-gray-400 text-sm"
            >
              ← {t('auth.backToHome')}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
