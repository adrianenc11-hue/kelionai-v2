import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, Send, Mic, MicOff, Camera, LogOut, User, CreditCard } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute, useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";

const CITY_BOKEH_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/city-bokeh-bg_c42045f6.jpg";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  createdAt: Date;
  confidence?: string;
  toolsUsed?: string[];
  audioUrl?: string;
}

export default function Chat() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId ? parseInt(params.conversationId) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<"kelion" | "kira">("kelion");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(conversationId);
  const [monitorContent, setMonitorContent] = useState<{ type: string; data: string; title?: string } | null>(null);
  const [mouthOpen, setMouthOpen] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const conversationIdForQuery = useMemo(() => activeConversationId || 0, [activeConversationId]);
  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { conversationId: conversationIdForQuery },
    { enabled: !!activeConversationId }
  );

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      if (data.conversationId && !activeConversationId) {
        setActiveConversationId(data.conversationId);
        navigate(`/chat/${data.conversationId}`);
      }
      const newMsg: Message = {
        id: Date.now(),
        role: "assistant",
        content: data.message,
        createdAt: new Date(),
        confidence: data.confidence,
        toolsUsed: data.toolsUsed,
        audioUrl: data.audioUrl,
      };
      setMessages((prev) => [...prev, newMsg]);
      setIsLoading(false);
      setLoadingStep("");

      // Visual content goes to monitor
      const msg = data.message || "";
      if (msg.includes("```") || (data.toolsUsed && data.toolsUsed.some((t: string) => ["search_web", "get_weather", "execute_code", "analyze_image"].includes(t)))) {
        const codeMatch = msg.match(/```[\s\S]*?```/);
        if (codeMatch) {
          setMonitorContent({ type: "code", data: codeMatch[0], title: "Code" });
        } else if (data.toolsUsed?.includes("get_weather")) {
          setMonitorContent({ type: "weather", data: msg, title: "Weather" });
        } else if (data.toolsUsed?.includes("search_web")) {
          setMonitorContent({ type: "search", data: msg, title: "Search" });
        } else if (data.toolsUsed?.includes("analyze_image")) {
          setMonitorContent({ type: "vision", data: msg, title: "Vision" });
        }
      }

      // Auto-play audio
      if (data.audioUrl && audioRef.current) {
        audioRef.current.src = data.audioUrl;
        audioRef.current.play().catch(() => {});
      }

      utils.chat.listConversations.invalidate();
    },
    onError: (error) => {
      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: "assistant",
        content: `Error: ${error.message}`,
        createdAt: new Date(),
      }]);
      setIsLoading(false);
      setLoadingStep("");
    },
  });

  useEffect(() => {
    if (conversationData?.messages) {
      setMessages(conversationData.messages.map((m) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      })));
    }
  }, [conversationData]);

  useEffect(() => {
    if (conversationId) setActiveConversationId(conversationId);
  }, [conversationId]);

  // Mouth animation synced to audio
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let animFrame: number;
    const animateMouth = () => {
      if (audio.paused || audio.ended) { setMouthOpen(0); return; }
      const t = audio.currentTime * 8;
      setMouthOpen(Math.min(1, Math.abs(Math.sin(t)) * 0.6 + Math.random() * 0.15));
      animFrame = requestAnimationFrame(animateMouth);
    };
    const onPlay = () => animateMouth();
    const onStop = () => { setMouthOpen(0); cancelAnimationFrame(animFrame); };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("ended", onStop);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("ended", onStop);
      cancelAnimationFrame(animFrame);
    };
  }, []);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMsg: Message = { id: Date.now(), role: "user", content: inputValue, createdAt: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setLoadingStep("Thinking...");
    const msgText = inputValue;
    setInputValue("");
    setTimeout(() => setLoadingStep("Analyzing..."), 800);
    setTimeout(() => setLoadingStep("Processing..."), 2000);
    await sendMessageMutation.mutateAsync({
      conversationId: activeConversationId || undefined,
      message: msgText,
      avatar: selectedAvatar,
    });
  };

  const handleLogout = async () => { logout(); };

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden" style={{ background: "#0c0e1a" }}>
      <audio ref={audioRef} className="hidden" />

      {/* ===== TOP BAR - minimal, exact like original ===== */}
      <header className="flex items-center justify-between px-4 py-2 shrink-0" style={{ background: "#0c0e1a", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {/* Left: Logo + Online */}
        <div className="flex items-center gap-3">
          <div>
            <span className="text-cyan-400 font-bold text-xl tracking-tight">KelionAI</span>
            <span className="text-[10px] text-slate-600 ml-1 block" style={{ marginTop: "-2px" }}>v4.0</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-green-500 rounded-full" style={{ boxShadow: "0 0 6px #22c55e" }} />
            <span className="text-xs text-green-400">Online</span>
          </div>
        </div>

        {/* Right: Kelion/Kira + user actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedAvatar("kelion")}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
            style={{
              background: selectedAvatar === "kelion" ? "#0891b2" : "transparent",
              color: selectedAvatar === "kelion" ? "#fff" : "#64748b",
              border: selectedAvatar === "kelion" ? "none" : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            Kelion
          </button>
          <button
            onClick={() => setSelectedAvatar("kira")}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
            style={{
              background: selectedAvatar === "kira" ? "#db2777" : "transparent",
              color: selectedAvatar === "kira" ? "#fff" : "#64748b",
              border: selectedAvatar === "kira" ? "none" : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            Kira
          </button>

          {user ? (
            <>
              <button onClick={() => navigate("/profile")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-white transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{user.name?.split(" ")[0]}</span>
              </button>
              <button onClick={() => navigate("/subscription")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-white transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <CreditCard className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Plan</span>
              </button>
              <button onClick={handleLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-red-400 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </>
          ) : (
            <a href={getLoginUrl()} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm text-white transition-colors" style={{ background: "#4f46e5" }}>
              <User className="w-3.5 h-3.5" />
              Login
            </a>
          )}
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Presentation Monitor - dark, clean */}
        <div className="flex-1 flex flex-col" style={{ background: "#0f1120" }}>
          <div className="flex-1 flex items-center justify-center overflow-auto p-6">
            {monitorContent ? (
              <div className="w-full max-w-2xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">{monitorContent.title}</span>
                  <button onClick={() => setMonitorContent(null)} className="text-[10px] text-slate-600 hover:text-slate-400">Clear</button>
                </div>
                <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-sm text-slate-200 leading-relaxed">
                    <Streamdown>{monitorContent.data}</Streamdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)" }}>
                  <span className="text-lg opacity-50">🎯</span>
                </div>
                <p className="text-sm text-slate-500 mb-1">Monitor de prezentare</p>
                <p className="text-xs text-slate-700">Cere o hartă, imagine, vreme, căutare sau cod</p>
              </div>
            )}
          </div>

          {/* Chat text messages - appears at bottom of monitor when there are messages */}
          {messages.length > 0 && (
            <div className="border-t px-4 py-3 max-h-[200px] overflow-y-auto space-y-2" style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}>
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "text-cyan-100"
                      : "text-slate-300"
                  }`} style={{
                    background: msg.role === "user" ? "rgba(8,145,178,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${msg.role === "user" ? "rgba(8,145,178,0.2)" : "rgba(255,255,255,0.05)"}`,
                  }}>
                    <Streamdown>{msg.content || ""}</Streamdown>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                    <span className="text-xs text-cyan-400">{loadingStep || "Working..."}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Working indicator when no messages yet */}
          {isLoading && messages.length <= 1 && (
            <div className="flex justify-center pb-4">
              <div className="rounded-lg px-4 py-2 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span className="text-sm text-cyan-400">{loadingStep || "Working..."}</span>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Avatar with city bokeh background */}
        <div className="w-[38%] min-w-[320px] max-w-[520px] relative shrink-0 flex flex-col" style={{
          backgroundImage: `url(${CITY_BOKEH_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}>
          {/* Avatar name */}
          <div className="absolute top-3 left-4 z-10">
            <span className="text-cyan-400 font-semibold text-base" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
              {selectedAvatar === "kelion" ? "Kelion" : "Kira"}
            </span>
          </div>

          {/* Avatar 3D */}
          <div className="flex-1 relative">
            <Avatar3D
              character={selectedAvatar}
              isAnimating={isLoading}
              emotion={isLoading ? "thinking" : "neutral"}
              mouthOpen={mouthOpen}
            />
            {/* Make avatar bg transparent so city bokeh shows through */}
            <style>{`
              .avatar-container canvas {
                background: transparent !important;
              }
            `}</style>
          </div>
        </div>
      </div>

      {/* ===== BOTTOM BAR: CAM | MIC | Input | SEND ===== */}
      <div className="px-4 py-2.5 shrink-0 flex items-center gap-2" style={{ background: "#0c0e1a", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-cyan-400 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }} aria-label="Camera">
          <Camera className="w-4 h-4" />
          <span>CAM</span>
        </button>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-cyan-400 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }} aria-label="Microphone">
          <Mic className="w-4 h-4" />
          <span>MIC</span>
        </button>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
          placeholder="Type or speak..."
          disabled={isLoading}
          className="flex-1 px-4 py-2.5 rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          aria-label="Message input"
        />
        <button
          onClick={handleSendMessage}
          disabled={isLoading || !inputValue.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40"
          style={{ background: "#4f46e5" }}
          aria-label="Send message"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>SEND</span>
        </button>
      </div>
    </div>
  );
}
