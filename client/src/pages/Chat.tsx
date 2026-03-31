import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Mic, MicOff, Volume2, VolumeX, Camera, Settings, LogOut } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute, useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  aiModel?: string | null;
  createdAt: Date;
  confidence?: string;
  toolsUsed?: string[];
  audioUrl?: string;
  visualContent?: { type: "image" | "map" | "weather" | "code" | "chart"; data: string };
}

interface VoiceCloningState {
  active: boolean;
  step: number;
  sampleText?: string;
  recording: boolean;
  mediaRecorder?: MediaRecorder;
  audioChunks: Blob[];
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
  const [voiceCloning, setVoiceCloning] = useState<VoiceCloningState>({ active: false, step: 0, recording: false, audioChunks: [] });
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [monitorContent, setMonitorContent] = useState<{ type: string; data: string; title?: string } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: conversations } = trpc.chat.listConversations.useQuery();
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
        aiModel: "Brain v4",
        createdAt: new Date(),
        confidence: data.confidence,
        toolsUsed: data.toolsUsed,
        audioUrl: data.audioUrl,
      };
      setMessages((prev) => [...prev, newMsg]);
      setIsLoading(false);
      setLoadingStep("");

      // Check if response contains visual content for the monitor
      const msg = data.message || "";
      if (msg.includes("```") || msg.includes("°C") || msg.includes("°F") || (data.toolsUsed && data.toolsUsed.some(t => ["search_web", "get_weather", "execute_code", "analyze_image"].includes(t)))) {
        // Extract visual content for monitor
        const codeMatch = msg.match(/```[\s\S]*?```/);
        if (codeMatch) {
          setMonitorContent({ type: "code", data: codeMatch[0], title: "Code Output" });
        } else if (data.toolsUsed?.includes("get_weather")) {
          setMonitorContent({ type: "weather", data: msg, title: "Weather" });
        } else if (data.toolsUsed?.includes("search_web")) {
          setMonitorContent({ type: "search", data: msg, title: "Search Results" });
        } else if (data.toolsUsed?.includes("analyze_image")) {
          setMonitorContent({ type: "vision", data: msg, title: "Image Analysis" });
        }
      }

      // Voice cloning trigger
      if (data.voiceCloningStep) {
        setVoiceCloning({
          active: true,
          step: data.voiceCloningStep.step,
          sampleText: data.voiceCloningStep.sampleText,
          recording: false,
          audioChunks: [],
        });
      }

      // Auto-play audio
      if (data.audioUrl && autoPlayAudio && audioRef.current) {
        audioRef.current.src = data.audioUrl;
        audioRef.current.play().catch(() => {});
      }

      utils.chat.listConversations.invalidate();
    },
    onError: (error) => {
      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: "assistant",
        content: `Error: ${error.message}. Please try again.`,
        createdAt: new Date(),
      }]);
      setIsLoading(false);
      setLoadingStep("");
    },
  });

  const voiceCloningMutation = trpc.chat.voiceCloningStep.useMutation();

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mouth animation synced to audio
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let animFrame: number;
    const animateMouth = () => {
      if (audio.paused || audio.ended) { setMouthOpen(0); return; }
      const t = audio.currentTime * 8;
      const val = Math.abs(Math.sin(t)) * 0.6 + Math.random() * 0.15;
      setMouthOpen(Math.min(1, val));
      animFrame = requestAnimationFrame(animateMouth);
    };
    const onPlay = () => animateMouth();
    const onPause = () => { setMouthOpen(0); cancelAnimationFrame(animFrame); };
    const onEnd = () => { setMouthOpen(0); cancelAnimationFrame(animFrame); };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
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
    setTimeout(() => setLoadingStep("Processing with Brain v4..."), 2000);
    setTimeout(() => setLoadingStep("Generating response..."), 4000);
    await sendMessageMutation.mutateAsync({
      conversationId: activeConversationId || undefined,
      message: msgText,
      avatar: selectedAvatar,
    });
  };

  // Voice cloning recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          setVoiceCloning((prev) => ({ ...prev, step: 3, recording: false }));
          try {
            const result = await voiceCloningMutation.mutateAsync({ step: 4, audioBase64: base64 });
            setVoiceCloning((prev) => ({ ...prev, step: result.step, sampleText: undefined }));
            if (result.action === "confirm") {
              setMessages((prev) => [...prev, { id: Date.now(), role: "assistant", content: `Voice cloned successfully! ${result.description}`, createdAt: new Date() }]);
            }
          } catch {
            setMessages((prev) => [...prev, { id: Date.now(), role: "assistant", content: "Voice cloning failed. Please try again.", createdAt: new Date() }]);
            setVoiceCloning({ active: false, step: 0, recording: false, audioChunks: [] });
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start();
      setVoiceCloning((prev) => ({ ...prev, recording: true, mediaRecorder }));
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => { voiceCloning.mediaRecorder?.stop(); };

  const handleLogout = async () => { await logout(); navigate("/"); };

  const ConfidenceBadge = ({ level }: { level?: string }) => {
    if (!level) return null;
    const colors: Record<string, string> = {
      verified: "bg-green-500/20 text-green-300",
      high: "bg-blue-500/20 text-blue-300",
      medium: "bg-yellow-500/20 text-yellow-300",
      low: "bg-red-500/20 text-red-300",
    };
    const labels: Record<string, string> = { verified: "Verified", high: "High", medium: "Medium", low: "Low" };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors[level] || ""}`}>{level === "verified" ? "✓ " : ""}{labels[level] || level}</span>;
  };

  // Feature badges
  const features = [
    { icon: "🧠", label: "Brain", desc: "Multi-model AI" },
    { icon: "🗣️", label: "Voice", desc: "Real-time conversation" },
    { icon: "👁️", label: "Vision", desc: "Image understanding" },
    { icon: "🔍", label: "Search", desc: "Live web results" },
    { icon: "🎨", label: "Create", desc: "AI image generation" },
    { icon: "🌍", label: "Languages", desc: "Any language" },
    { icon: "🔒", label: "Security", desc: "GDPR compliant" },
  ];

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Card className="p-8 bg-slate-900 border-slate-800 text-center">
          <h2 className="text-xl font-bold text-white mb-4">Please log in to access KelionAI Chat</h2>
          <Button onClick={() => navigate("/")} className="bg-blue-600 hover:bg-blue-700">Go to Home</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-slate-950 flex flex-col overflow-hidden" role="main" aria-label="KelionAI Chat">
      <audio ref={audioRef} className="hidden" />

      {/* ===== TOP BAR ===== */}
      <header className="bg-slate-950 border-b border-slate-800/50 px-4 py-2 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-cyan-400 font-bold text-xl tracking-tight hover:text-cyan-300 transition-colors">
            KelionAI
          </button>
          <span className="text-[10px] text-slate-600">v4.0</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[11px] text-green-400">Online</span>
          </div>
          {user && (
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {user.name} ({user.role === "admin" ? "Admin" : "Free"})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Avatar selector */}
          <Button
            onClick={() => setSelectedAvatar("kelion")}
            size="sm"
            className={`text-xs h-7 px-3 ${selectedAvatar === "kelion" ? "bg-cyan-600 text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
          >
            Kelion
          </Button>
          <Button
            onClick={() => setSelectedAvatar("kira")}
            size="sm"
            className={`text-xs h-7 px-3 ${selectedAvatar === "kira" ? "bg-pink-600 text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
          >
            Kira
          </Button>
          <div className="w-px h-5 bg-slate-800 mx-1" />
          <Button variant="ghost" size="sm" onClick={() => setAutoPlayAudio(!autoPlayAudio)} className={`p-1.5 h-7 w-7 ${autoPlayAudio ? "text-cyan-400" : "text-slate-600"}`} aria-label="Toggle audio">
            {autoPlayAudio ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)} className="p-1.5 h-7 w-7 text-slate-500" aria-label="Settings">
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="p-1.5 h-7 w-7 text-slate-500 hover:text-red-400" aria-label="Logout">
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      {/* ===== FEATURE BADGES ===== */}
      <div className="bg-slate-950/80 border-b border-slate-800/30 px-4 py-1.5 flex items-center gap-3 overflow-x-auto shrink-0 scrollbar-hide">
        {features.map((f) => (
          <div key={f.label} className="flex items-center gap-1.5 shrink-0" title={f.desc}>
            <span className="text-sm">{f.icon}</span>
            <div className="leading-none">
              <span className="text-[10px] font-semibold text-slate-300 block">{f.label}</span>
              <span className="text-[9px] text-slate-600">{f.desc}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ===== MAIN CONTENT: Monitor LEFT | Avatar + Chat RIGHT ===== */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Presentation Monitor */}
        <div className="flex-1 flex flex-col bg-slate-900/50 border-r border-slate-800/30">
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            {monitorContent ? (
              <div className="w-full max-w-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">{monitorContent.title || "Result"}</span>
                  <button onClick={() => setMonitorContent(null)} className="text-[10px] text-slate-600 hover:text-slate-400 ml-auto">Clear</button>
                </div>
                <Card className="bg-slate-800/60 border-slate-700/50 p-4 md:p-6">
                  <div className="text-sm text-slate-200 leading-relaxed">
                    <Streamdown>{monitorContent.data}</Streamdown>
                  </div>
                </Card>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <span className="text-2xl">🎯</span>
                </div>
                <h3 className="text-base font-medium text-slate-400 mb-1">Presentation Monitor</h3>
                <p className="text-xs text-slate-600 max-w-xs">
                  Ask for a map, image, weather, search or code and results will appear here
                </p>
              </div>
            )}
          </div>

          {/* Voice Cloning UI on monitor */}
          {voiceCloning.active && (
            <div className="p-4 border-t border-slate-800/30">
              <Card className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border-purple-500/30 p-4 max-w-lg mx-auto">
                <h3 className="text-base font-bold text-purple-400 mb-2">
                  Voice Cloning - Step {voiceCloning.step}/5
                </h3>
                {voiceCloning.step === 1 && (
                  <div>
                    <p className="text-sm text-slate-300 mb-3">Read the text below out loud in a quiet place:</p>
                    <div className="bg-slate-800 rounded-lg p-3 mb-3 text-sm text-slate-200 leading-relaxed border border-slate-700">
                      {voiceCloning.sampleText}
                    </div>
                    <Button onClick={() => setVoiceCloning((prev) => ({ ...prev, step: 2 }))} className="bg-purple-600 hover:bg-purple-700">
                      I'm Ready - Next Step
                    </Button>
                  </div>
                )}
                {voiceCloning.step === 2 && (
                  <div>
                    <p className="text-sm text-slate-300 mb-3">Press record and read the text (30-60 seconds):</p>
                    {!voiceCloning.recording ? (
                      <Button onClick={startRecording} className="bg-red-600 hover:bg-red-700 gap-2">
                        <Mic className="w-4 h-4" /> Start Recording
                      </Button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-red-400 text-sm">Recording...</span>
                        <Button onClick={stopRecording} variant="outline" size="sm" className="border-red-500 text-red-400">
                          <MicOff className="w-4 h-4 mr-1" /> Stop
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {voiceCloning.step === 3 && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <p className="text-sm text-slate-300">Processing your voice with ElevenLabs AI...</p>
                  </div>
                )}
                {voiceCloning.step === 4 && (
                  <div>
                    <p className="text-sm text-green-400 mb-3">Voice cloned successfully!</p>
                    <div className="flex gap-2">
                      <Button onClick={() => setVoiceCloning((prev) => ({ ...prev, step: 5 }))} className="bg-green-600 hover:bg-green-700">Save Voice</Button>
                      <Button onClick={() => setVoiceCloning({ active: false, step: 0, recording: false, audioChunks: [] })} variant="outline" className="border-slate-600 text-slate-400">Cancel</Button>
                    </div>
                  </div>
                )}
                {voiceCloning.step === 5 && (
                  <div>
                    <p className="text-sm text-green-400">Voice saved! The AI will now respond using your voice.</p>
                    <Button onClick={() => setVoiceCloning({ active: false, step: 0, recording: false, audioChunks: [] })} variant="outline" size="sm" className="mt-2 border-slate-600 text-slate-400">Close</Button>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>

        {/* RIGHT: Avatar + Chat text below */}
        <div className="w-[340px] lg:w-[400px] xl:w-[440px] flex flex-col shrink-0 bg-slate-950">

          {/* Avatar 3D - top portion */}
          <div className="flex-1 relative min-h-0">
            <Avatar3D
              character={selectedAvatar}
              isAnimating={isLoading}
              emotion={isLoading ? "thinking" : "neutral"}
              mouthOpen={mouthOpen}
            />
            {/* Settings overlay */}
            {showSettings && (
              <div className="absolute bottom-3 left-3 right-3 bg-slate-900/95 backdrop-blur rounded-lg p-3 border border-slate-700 z-10">
                <label className="text-[10px] text-slate-400 block mb-1">Mouth Control</label>
                <input type="range" min="0" max="100" value={Math.round(mouthOpen * 100)} onChange={(e) => setMouthOpen(parseInt(e.target.value) / 100)} className="w-full accent-purple-500" aria-label="Mouth open amount" />
                <p className="text-[10px] text-slate-500 mt-0.5 text-center">{Math.round(mouthOpen * 100)}%</p>
              </div>
            )}
          </div>

          {/* Chat text - below avatar */}
          <div className="h-[200px] lg:h-[240px] border-t border-slate-800/50 flex flex-col bg-slate-900/30">
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" role="log" aria-label="Chat messages" aria-live="polite">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center px-2">
                    <p className="text-xs text-slate-500 mb-2">Type or speak to start a conversation</p>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {["What's the weather?", "Teach me something", "Write code", "Clone my voice"].map((s) => (
                        <button key={s} onClick={() => setInputValue(s)} className="text-[10px] px-2 py-1 rounded-full border border-slate-700 text-slate-500 hover:text-cyan-400 hover:border-cyan-500/50 transition-colors">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] rounded-lg px-2.5 py-1.5 ${
                      msg.role === "user"
                        ? "bg-cyan-600/20 text-cyan-100 border border-cyan-500/20"
                        : "bg-slate-800/60 text-slate-200 border border-slate-700/30"
                    }`}>
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[9px] text-slate-500 font-medium">{selectedAvatar === "kelion" ? "Kelion" : "Kira"}</span>
                          <ConfidenceBadge level={msg.confidence} />
                        </div>
                      )}
                      <div className="text-xs leading-relaxed">
                        <Streamdown>{msg.content || ""}</Streamdown>
                      </div>
                      {msg.audioUrl && (
                        <button onClick={() => { if (audioRef.current) { audioRef.current.src = msg.audioUrl!; audioRef.current.play(); } }} className="mt-1 flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300">
                          <Volume2 className="w-2.5 h-2.5" /> Play
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Working indicator */}
              {isLoading && (
                <div className="flex justify-start" role="status" aria-label="AI is working">
                  <div className="bg-slate-800/60 border border-slate-700/30 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span className="text-xs text-cyan-400">{loadingStep || "Working..."}</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ===== BOTTOM BAR: CAM | MIC | Input | SEND ===== */}
      <div className="bg-slate-950 border-t border-slate-800/50 px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 max-w-full">
          <Button variant="ghost" size="sm" className="text-slate-500 hover:text-cyan-400 h-9 px-2 shrink-0" aria-label="Toggle camera">
            <Camera className="w-4 h-4 mr-1" />
            <span className="text-[10px] hidden sm:inline">CAM</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-slate-500 hover:text-cyan-400 h-9 px-2 shrink-0" aria-label="Toggle microphone">
            <Mic className="w-4 h-4 mr-1" />
            <span className="text-[10px] hidden sm:inline">MIC</span>
          </Button>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
            placeholder="Type or speak..."
            disabled={isLoading}
            className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50"
            aria-label="Message input"
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || !inputValue.trim()}
            className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white h-9 px-3 shrink-0 gap-1"
            aria-label="Send message"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="text-xs hidden sm:inline">SEND</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
