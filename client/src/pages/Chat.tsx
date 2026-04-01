import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, Send, Mic, MicOff, Camera, CameraOff, User, History, X, Pencil, Trash2, Check } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute, useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";
import { useTranslation } from "react-i18next";

const CITY_BOKEH_BG = "[d2xsxph8kpxj0f.cloudfront.net](https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/city-bokeh-bg_c42045f6.jpg)";

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
  const { t, i18n } = useTranslation();
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId ? parseInt(params.conversationId) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<"kelion" | "kira">("kelion");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(conversationId);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");

  // LIVE VOICE state
  const [isLiveVoice, setIsLiveVoice] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const liveAudioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLiveVoiceRef = useRef(false);

  // CAM state
  const [isCamOpen, setIsCamOpen] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const { data: trialStatus } = trpc.trial.getStatus.useQuery(undefined, { enabled: !!user });
  const transcribeAudioMutation = trpc.voice.transcribeAudio.useMutation();
  const uploadImageMutation = trpc.voice.uploadImage.useMutation();

  const editMessageMutation = trpc.chat.editMessage.useMutation({
    onSuccess: () => {
      setMessages(prev => prev.map(m => m.id === editingMessageId ? { ...m, content: editingContent } : m));
      setEditingMessageId(null);
      setEditingContent("");
    },
  });
  const deleteMessageMutation = trpc.chat.deleteMessage.useMutation({
    onSuccess: (_, vars) => {
      setMessages(prev => prev.filter(m => m.id !== vars.messageId));
    },
  });

  const utils = trpc.useUtils();
  const conversationIdForQuery = useMemo(() => activeConversationId || 0, [activeConversationId]);
  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { conversationId: conversationIdForQuery },
    { enabled: !!activeConversationId }
  );
  const { data: conversationsList } = trpc.chat.listConversations.useQuery(
    undefined, { enabled: showHistory }
  );

  useEffect(() => {
    setMessages([]);
    setActiveConversationId(conversationId);
    if (conversationId) utils.chat.getConversation.invalidate({ conversationId });
  }, [conversationId]);

  useEffect(() => {
    if (conversationData?.messages && activeConversationId) {
      setMessages(conversationData.messages.map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })));
    }
  }, [conversationData, activeConversationId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let animFrame: number;
    const setupAnalyser = () => {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      if (!analyserRef.current) {
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.4;
      }
      if (!sourceRef.current) {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      }
    };
    const animateMouth = () => {
      if (!analyserRef.current || audio.paused || audio.ended) { setMouthOpen(0); return; }
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 2; i < 40; i++) sum += dataArray[i];
      const avg = sum / 38;
      const normalized = Math.max(0, (avg - 30) / 120);
      setMouthOpen((prev) => prev * 0.3 + Math.min(1, normalized * 1.8) * 0.7);
      animFrame = requestAnimationFrame(animateMouth);
    };
    const onPlay = () => { try { setupAnalyser(); if (audioContextRef.current?.state === "suspended") audioContextRef.current.resume(); } catch {} animateMouth(); };
    const onStop = () => { setMouthOpen(0); cancelAnimationFrame(animFrame); };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("ended", onStop);
    return () => { audio.removeEventListener("play", onPlay); audio.removeEventListener("pause", onStop); audio.removeEventListener("ended", onStop); cancelAnimationFrame(animFrame); };
  }, []);

  useEffect(() => {
    return () => { if (camStream) camStream.getTracks().forEach(t => t.stop()); };
  }, [camStream]);

  // ========== LIVE VOICE ==========
  const stopLiveVoice = useCallback(() => {
    isLiveVoiceRef.current = false;
    setIsLiveVoice(false);
    setIsListening(false);
    setIsSpeaking(false);
    setLiveStatus("");
    if (liveMediaRecorderRef.current && liveMediaRecorderRef.current.state !== "inactive") {
      liveMediaRecorderRef.current.stop();
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach(t => t.stop());
      liveStreamRef.current = null;
    }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const startListening = useCallback(async () => {
    if (!isLiveVoiceRef.current) return;
    try {
      if (!liveStreamRef.current) {
        liveStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      let mimeType = "";
      for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""]) {
        if (type === "" || MediaRecorder.isTypeSupported(type)) { mimeType = type; break; }
      }
      const recorder = new MediaRecorder(liveStreamRef.current, mimeType ? { mimeType } : undefined);
      liveAudioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) liveAudioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(liveAudioChunksRef.current, { type: "audio/webm" });
        if (!isLiveVoiceRef.current || blob.size < 500) { if (isLiveVoiceRef.current) startListening(); return; }
        setIsListening(false);
        setLiveStatus("Transcribing...");
        setIsLoading(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });
          const { text, language } = await transcribeAudioMutation.mutateAsync({ audioBase64: base64, mimeType: "audio/webm" });
          if (!text || text.trim().length === 0) { setIsLoading(false); setLiveStatus(""); if (isLiveVoiceRef.current) startListening(); return; }

          // Detect language and switch UI
          if (language && language !== i18n.language) i18n.changeLanguage(language);

          // Show only current user message - clear previous live messages
          setMessages(prev => {
            const filtered = prev.filter(m => m.role !== "system");
            return [...filtered, { id: Date.now(), role: "user", content: text, createdAt: new Date() }];
          });

          setLiveStatus("Thinking...");
          const response = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ message: text, conversationId: activeConversationId || undefined, avatar: selectedAvatar, language }),
          });
          if (!response.ok || !response.body) throw new Error("Stream failed");
          const streamReader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullContent = "";
          while (true) {
            const { done, value } = await streamReader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === "meta" && parsed.conversationId && !activeConversationId) {
                  setActiveConversationId(parsed.conversationId);
                  navigate(`/chat/${parsed.conversationId}`);
                } else if (parsed.type === "token") {
                  fullContent += parsed.content;
                  setStreamingText(fullContent);
                } else if (parsed.type === "done") {
                  // In live mode: show only last assistant line
                  setMessages(prev => {
                    const filtered = prev.filter(m => !(m.role === "assistant" && (m as any).isLive));
                    return [...filtered, { id: Date.now(), role: "assistant", content: fullContent, createdAt: new Date(), audioUrl: parsed.audioUrl, isLive: true } as any];
                  });
                  setStreamingText("");
                  if (parsed.audioUrl && audioRef.current) {
                    setIsSpeaking(true);
                    setLiveStatus("Speaking...");
                    audioRef.current.src = parsed.audioUrl;
                    audioRef.current.onended = () => {
                      setIsSpeaking(false);
                      setLiveStatus("");
                      if (isLiveVoiceRef.current) startListening();
                    };
                    audioRef.current.play().catch(() => { setIsSpeaking(false); setLiveStatus(""); if (isLiveVoiceRef.current) startListening(); });
                  } else {
                    if (isLiveVoiceRef.current) startListening();
                  }
                  utils.chat.listConversations.invalidate();
                }
              } catch {}
            }
          }
        } catch (err: any) {
          setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: `Error: ${err.message}`, createdAt: new Date() }]);
          if (isLiveVoiceRef.current) startListening();
        }
        setIsLoading(false);
        setLiveStatus("");
      };
      recorder.start(250);
      liveMediaRecorderRef.current = recorder;
      setIsListening(true);
      setLiveStatus("Listening...");
      silenceTimerRef.current = setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 8000);
    } catch { stopLiveVoice(); }
  }, [activeConversationId, selectedAvatar, transcribeAudioMutation, navigate, utils, i18n, stopLiveVoice]);

  const handleMicClick = useCallback(async () => {
    if (isLiveVoice) { stopLiveVoice(); } else {
      isLiveVoiceRef.current = true;
      setIsLiveVoice(true);
      await startListening();
    }
  }, [isLiveVoice, startListening, stopLiveVoice]);

  // ========== CAM ==========
  const openCamera = useCallback(async () => {
    try {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
      setCamStream(stream);
      setIsCamOpen(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 100);
    } catch { alert("Camera error"); }
  }, []);

  const closeCamera = useCallback(() => {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); setCamStream(null); }
    setIsCamOpen(false);
  }, [camStream]);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    closeCamera();
    setIsLoading(true);
    setLoadingStep("Analyzing...");
    try {
      const { imageUrl } = await uploadImageMutation.mutateAsync({ imageBase64, mimeType: "image/jpeg" });
      setMessages(prev => [...prev, { id: Date.now(), role: "user", content: "📷 [Camera capture]", createdAt: new Date() }]);
      const question = inputValue.trim() || "Describe what you see.";
      setInputValue("");
      setStreamingText("");
      const response = await fetch("/api/chat/stream", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ message: question, conversationId: activeConversationId || undefined, avatar: selectedAvatar, imageUrl }),
      });
      if (!response.ok || !response.body) throw new Error("Stream failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", fullContent = "";
      setLoadingStep("");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.type === "meta" && p.conversationId && !activeConversationId) { setActiveConversationId(p.conversationId); navigate(`/chat/${p.conversationId}`); }
            else if (p.type === "token") { fullContent += p.content; setStreamingText(fullContent); }
            else if (p.type === "done") {
              setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: fullContent, createdAt: new Date(), audioUrl: p.audioUrl }]);
              setStreamingText("");
              if (p.audioUrl && audioRef.current) { audioRef.current.src = p.audioUrl; audioRef.current.play().catch(() => {}); }
              utils.chat.listConversations.invalidate();
            }
          } catch {}
        }
      }
    } catch (err: any) { setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: `Error: ${err.message}`, createdAt: new Date() }]); }
    setIsLoading(false); setLoadingStep("");
  }, [activeConversationId, selectedAvatar, inputValue, closeCamera, uploadImageMutation, navigate, utils]);

  const handleCamClick = useCallback(() => { if (isCamOpen) closeCamera(); else openCamera(); }, [isCamOpen, openCamera, closeCamera]);

  // ========== TEXT SEND ==========
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMsg: Message = { id: Date.now(), role: "user", content: inputValue, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true); setLoadingStep("Thinking..."); const msgText = inputValue; setInputValue(""); setStreamingText("");
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ message: msgText, conversationId: activeConversationId || undefined, avatar: selectedAvatar }),
      });
      if (!response.ok || !response.body) throw new Error("Stream failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", fullContent = "";
      setLoadingStep("");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "meta" && parsed.conversationId && !activeConversationId) { setActiveConversationId(parsed.conversationId); navigate(`/chat/${parsed.conversationId}`); }
            else if (parsed.type === "token") { fullContent += parsed.content; setStreamingText(fullContent); }
            else if (parsed.type === "done") {
              setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: fullContent, createdAt: new Date(), audioUrl: parsed.audioUrl }]);
              setStreamingText("");
              if (parsed.audioUrl && audioRef.current) { audioRef.current.src = parsed.audioUrl; audioRef.current.play().catch(() => {}); }
              utils.chat.listConversations.invalidate();
            } else if (parsed.type === "error") throw new Error(parsed.error);
          } catch (e: any) { if (line.slice(6).trim() && line.slice(6).trim() !== "[DONE]") console.warn("[Chat]", e?.message); }
        }
      }
    } catch (error: any) { setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: `Error: ${error.message}`, createdAt: new Date() }]); setStreamingText(""); }
    setIsLoading(false); setLoadingStep("");
  };

  const handleNewChat = () => { setMessages([]); setActiveConversationId(null); navigate("/chat"); };

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden relative" style={{ background: "#0c0e1a" }}>
      <audio ref={audioRef} className="hidden" crossOrigin="anonymous" />
      <canvas ref={canvasRef} className="hidden" />

      {/* TOP BAR */}
      <header className="flex items-center justify-between px-4 py-2 shrink-0" style={{ background: "#0c0e1a", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
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
        <div className="flex items-center gap-2">
          <button onClick={handleNewChat} className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-cyan-400 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            {t("nav.newChat")}
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("nav.history")}</span>
          </button>
          {user ? (
            <button onClick={() => navigate("/profile")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-white transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
              <User className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{user.name?.split(" ")[0]}</span>
            </button>
          ) : (
            <a href={getLoginUrl() || "#"} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm text-white" style={{ background: "#4f46e5" }}>
              <User className="w-3.5 h-3.5" />Login
            </a>
          )}
        </div>
      </header>

      {/* HISTORY DRAWER */}
      {showHistory && (
        <div className="absolute inset-0 z-40 flex" style={{ top: "48px" }}>
          <div className="w-72 h-full overflow-y-auto py-3 px-2" style={{ background: "#0f1120", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between px-2 mb-3">
              <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">Chat History</span>
              <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {conversationsList && conversationsList.length > 0 ? conversationsList.map((conv: any) => (
              <button key={conv.id} onClick={() => { navigate(`/chat/${conv.id}`); setShowHistory(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 text-xs transition-colors ${activeConversationId === conv.id ? "text-cyan-300" : "text-slate-400 hover:text-white"}`}
                style={{ background: activeConversationId === conv.id ? "rgba(8,145,178,0.15)" : "transparent", border: activeConversationId === conv.id ? "1px solid rgba(8,145,178,0.2)" : "1px solid transparent" }}>
                <div className="font-medium truncate">{conv.title || "Untitled"}</div>
                <div className="text-[10px] text-slate-600 mt-0.5">{new Date(conv.createdAt).toLocaleDateString()}</div>
              </button>
            )) : <p className="text-xs text-slate-600 px-3">No conversations yet</p>}
          </div>
          <div className="flex-1" onClick={() => setShowHistory(false)} />
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* LEFT: Monitor */}
        <div className="flex flex-1 flex-col" style={{ background: "#0f1120" }}>
          <div className="flex-1 flex items-center justify-center overflow-auto p-6">
            {isCamOpen ? (
              <div className="w-full max-w-sm text-center">
                <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
                <div className="flex items-center justify-center mb-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse" style={{ background: "rgba(8,145,178,0.15)", border: "2px solid rgba(8,145,178,0.4)" }}>
                    <Camera className="w-7 h-7 text-cyan-400" />
                  </div>
                </div>
                <p className="text-sm text-cyan-400 font-semibold mb-2">Camera Active</p>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={captureAndAnalyze} disabled={isLoading} className="px-5 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg, #0891b2, #4f46e5)" }}>Capture & Analyze</button>
                  <button onClick={closeCamera} className="px-4 py-2.5 rounded-full text-sm text-red-400" style={{ border: "1px solid rgba(239,68,68,0.3)" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-slate-500 mb-1">{t("chat.presentationMonitor")}</p>
                <p className="text-xs text-slate-700">{t("chat.monitorHint")}</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Avatar + Chat */}
        <div className="w-full md:w-[55%] md:min-w-[400px] md:max-w-[700px] shrink-0 relative" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="absolute inset-0" style={{ backgroundImage: `url(${CITY_BOKEH_BG})`, backgroundSize: "cover", backgroundPosition: "center", zIndex: 0 }} />
          <div className="absolute top-3 left-0 right-0 flex justify-center" style={{ zIndex: 10 }}>
            <span className="text-cyan-400 font-semibold text-base" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
              {selectedAvatar === "kelion" ? "Kelion" : "Kira"}
            </span>
          </div>
          <button onClick={() => setSelectedAvatar("kelion")} className="absolute left-3 top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: selectedAvatar === "kelion" ? "rgba(8,145,178,0.8)" : "rgba(0,0,0,0.4)", color: selectedAvatar === "kelion" ? "#fff" : "rgba(255,255,255,0.5)", border: selectedAvatar === "kelion" ? "2px solid #0891b2" : "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", zIndex: 15, writingMode: "vertical-rl" }}>
            Kelion
          </button>
          <button onClick={() => setSelectedAvatar("kira")} className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: selectedAvatar === "kira" ? "rgba(219,39,119,0.8)" : "rgba(0,0,0,0.4)", color: selectedAvatar === "kira" ? "#fff" : "rgba(255,255,255,0.5)", border: selectedAvatar === "kira" ? "2px solid #db2777" : "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", zIndex: 15, writingMode: "vertical-rl" }}>
            Kira
          </button>
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            <Avatar3D character={selectedAvatar} isAnimating={isLoading} emotion={isLoading ? "thinking" : "neutral"} mouthOpen={mouthOpen} />
          </div>

          {/* Live voice status indicator */}
          {isLiveVoice && (
            <div className="absolute top-12 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
              <div className="px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2"
                style={{ background: isListening ? "rgba(34,197,94,0.3)" : isSpeaking ? "rgba(8,145,178,0.3)" : "rgba(234,179,8,0.3)", border: isListening ? "1px solid rgba(34,197,94,0.5)" : isSpeaking ? "1px solid rgba(8,145,178,0.5)" : "1px solid rgba(234,179,8,0.5)", backdropFilter: "blur(8px)" }}>
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: isListening ? "#22c55e" : isSpeaking ? "#0891b2" : "#eab308" }} />
                <span style={{ color: isListening ? "#22c55e" : isSpeaking ? "#0891b2" : "#eab308" }}>{liveStatus}</span>
              </div>
            </div>
          )}

          {/* Chat overlay - in live mode show only last exchange */}
          <div className="absolute bottom-0 left-0 right-0 max-h-[35%] overflow-y-auto px-3 py-2 space-y-2"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)", zIndex: 20 }}>
            {isLiveVoice ? (
              // Live mode: show only last user + last assistant
              <>
                {messages.filter(m => m.role === "user").slice(-1).map(msg => (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs text-cyan-100" style={{ background: "rgba(8,145,178,0.15)", border: "1px solid rgba(8,145,178,0.2)" }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {messages.filter(m => m.role === "assistant").slice(-1).map(msg => (
                  <div key={msg.id} className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs text-slate-300" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <Streamdown>{msg.content || ""}</Streamdown>
                    </div>
                  </div>
                ))}
                {streamingText && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs text-slate-200" style={{ background: "rgba(255,255,255,0.04)" }}>
                      {streamingText}<span className="animate-pulse text-cyan-400">|</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              // Normal mode: show all messages
              <>
                {messages.length === 0 && !isLoading && (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-slate-600 italic">Start a conversation...</p>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"} group relative`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed relative ${msg.role === "user" ? "text-cyan-100" : msg.role === "system" ? "text-yellow-300 italic" : "text-slate-300"}`}
                      style={{ background: msg.role === "user" ? "rgba(8,145,178,0.15)" : msg.role === "system" ? "rgba(234,179,8,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${msg.role === "user" ? "rgba(8,145,178,0.2)" : msg.role === "system" ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.05)"}` }}>
                      {editingMessageId === msg.id ? (
                        <div className="flex items-center gap-1">
                          <input value={editingContent} onChange={(e) => setEditingContent(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") editMessageMutation.mutate({ messageId: msg.id, content: editingContent }); if (e.key === "Escape") { setEditingMessageId(null); setEditingContent(""); } }}
                            className="flex-1 bg-transparent text-xs text-cyan-100 outline-none border-b border-cyan-400/30" autoFocus />
                          <button onClick={() => editMessageMutation.mutate({ messageId: msg.id, content: editingContent })} className="text-green-400"><Check className="w-3 h-3" /></button>
                          <button onClick={() => { setEditingMessageId(null); setEditingContent(""); }} className="text-red-400"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <Streamdown>{msg.content || ""}</Streamdown>
                      )}
                      {msg.role === "user" && editingMessageId !== msg.id && (
                        <div className="absolute -top-5 right-0 hidden group-hover:flex items-center gap-1 bg-slate-800/90 rounded px-1 py-0.5" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                          <button onClick={() => { setEditingMessageId(msg.id); setEditingContent(msg.content || ""); }} className="text-slate-400 hover:text-cyan-400 p-0.5"><Pencil className="w-2.5 h-2.5" /></button>
                          <button onClick={() => { if (confirm("Delete?")) deleteMessageMutation.mutate({ messageId: msg.id }); }} className="text-slate-400 hover:text-red-400 p-0.5"><Trash2 className="w-2.5 h-2.5" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {streamingText && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap">{streamingText}<span className="animate-pulse text-cyan-400">|</span></p>
                    </div>
                  </div>
                )}
                {isLoading && !streamingText && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                      <span className="text-xs text-cyan-400">{loadingStep || "Thinking..."}</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>

      {/* TRIAL BAR */}
      {trialStatus?.isTrialUser && (
        <div className="px-4 py-1.5 shrink-0 flex items-center justify-between text-xs" style={{ background: trialStatus.canUse ? "rgba(8,145,178,0.1)" : "rgba(239,68,68,0.15)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-3">
            {trialStatus.canUse ? (
              <><span className="text-cyan-400">{t("chat.freeTrial")}</span><span className="text-slate-400">{trialStatus.trialDaysLeft} {t("chat.daysLeft")}</span></>
            ) : (
              <span className="text-red-400">{trialStatus.reason}</span>
            )}
          </div>
          <button onClick={() => navigate("/pricing")} className="px-3 py-1 rounded-full text-xs font-medium text-white" style={{ background: "linear-gradient(135deg, #8b5cf6, #db2777)" }}>
            {t("chat.upgrade")}
          </button>
        </div>
      )}

      {/* BOTTOM BAR */}
      <div className="px-4 py-2.5 shrink-0 flex items-center gap-2" style={{ background: "#0c0e1a", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {/* CAM */}
        <button onClick={handleCamClick} disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all"
          style={{
            border: isCamOpen ? "1px solid rgba(8,145,178,0.6)" : "1px solid rgba(255,255,255,0.1)",
            background: isCamOpen ? "rgba(8,145,178,0.25)" : "transparent",
            color: isCamOpen ? "#67e8f9" : "#94a3b8",
            boxShadow: isCamOpen ? "0 0 12px rgba(8,145,178,0.4)" : "none",
          }}>
          {isCamOpen ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          <span>CAM</span>
        </button>

        {/* MIC */}
        <button onClick={handleMicClick} disabled={isLoading && !isLiveVoice}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all"
          style={{
            border: isLiveVoice ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.1)",
            background: isLiveVoice ? "rgba(239,68,68,0.25)" : "transparent",
            color: isLiveVoice ? "#fca5a5" : "#94a3b8",
            boxShadow: isLiveVoice ? "0 0 12px rgba(239,68,68,0.4)" : "none",
            animation: isListening ? "pulse 1s ease-in-out infinite" : "none",
          }}>
          {isLiveVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          <span>{isLiveVoice ? (isListening ? "🔴 LIVE" : "● LIVE") : "MIC"}</span>
        </button>

        <input ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
          placeholder="Type or speak..." disabled={isLoading}
          className="flex-1 px-4 py-2.5 rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }} />
        <button onClick={handleSendMessage} disabled={isLoading || !inputValue.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40"
          style={{ background: "#4f46e5" }}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>SEND</span>
        </button>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
