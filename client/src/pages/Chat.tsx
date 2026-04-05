import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, Send, Mic, MicOff, Camera, CameraOff, LogOut, User, X, History, Monitor, Brain, Sun, Moon } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute, useLocation } from "wouter";
import Avatar3D from "@/components/Avatar3D";
import MemoryPanel from "@/components/MemoryPanel";
import MonitorPanel, { MonitorItem } from "@/components/MonitorPanel";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import PermissionsGate from "@/components/PermissionsGate";
import { useLocation as useUserLocation } from "@/hooks/useLocation";

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
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const userLocation = useUserLocation();

  const [messages, setMessages] = useState<Message[]>([]);
  const lastMessage = messages.filter((m: any) => m.role !== "system").at(-1);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<"kelion" | "kira">("kelion");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(conversationId);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  // New state for Monitor + Memory panels
  const [showMemory, setShowMemory] = useState(false);
  const [showMonitor, setShowMonitor] = useState(true);
  const [monitorItems, setMonitorItems] = useState<MonitorItem[]>([]);
  const [activeThinking, setActiveThinking] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CAM state - silent capture
  const [isCamOpen, setIsCamOpen] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Audio analyser for mouth amplitude
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const utils = trpc.useUtils();
  const conversationIdForQuery = useMemo(() => activeConversationId || 0, [activeConversationId]);
  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { conversationId: conversationIdForQuery },
    { enabled: !!activeConversationId }
  );
  const { data: conversationsList } = trpc.chat.listConversations.useQuery(
    undefined,
    { enabled: showHistory }
  );

  // tRPC mutations
  const uploadAudioMutation = trpc.voice.uploadAudio.useMutation();
  const transcribeAudioMutation = trpc.voice.transcribeAudio.useMutation();
  const uploadImageMutation = trpc.voice.uploadImage.useMutation();
  const liveAudioMutation = trpc.voice.liveAudio.useMutation();
  const generateImageMutation = trpc.media.generateImage.useMutation();
  const generateVideoMutation = trpc.media.generateVideo.useMutation();

  // Parse AI response content and add to monitor items
  const parseAndAddMonitorItem = useCallback((msg: string, toolsUsed?: string[]) => {
    const id = `${Date.now()}-${Math.random()}`;
    const timestamp = new Date();

    const codeMatch = msg.match(/```(?:\w+\n)?([\s\S]*?)```/);
    if (codeMatch) {
      setMonitorItems((prev) => [...prev, {
        id, type: "code", title: t("monitor.code"), content: codeMatch[1].trim(), timestamp,
      }]);
      return;
    }
    if (toolsUsed?.includes("get_weather") || msg.includes("[VERIFIED] Weather") || msg.toLowerCase().includes("weather")) {
      setMonitorItems((prev) => [...prev, {
        id, type: "weather", title: t("monitor.weather"), content: msg.slice(0, 500), timestamp,
      }]);
      return;
    }
    if (toolsUsed?.includes("search_web") || msg.includes("Related:") || msg.toLowerCase().includes("wikipedia")) {
      setMonitorItems((prev) => [...prev, {
        id, type: "search", title: t("monitor.search"), content: msg.slice(0, 500), timestamp,
      }]);
      return;
    }
    if (toolsUsed?.includes("analyze_image") || msg.includes("[VISION]")) {
      setMonitorItems((prev) => [...prev, {
        id, type: "vision", title: t("monitor.vision"), content: msg.slice(0, 500), timestamp,
      }]);
      return;
    }
    if (msg.includes("[CALCULATED]") || /^\s*[\d\s\+\-\*\/\(\)=]+$/.test(msg.slice(0, 100))) {
      setMonitorItems((prev) => [...prev, {
        id, type: "math", title: t("monitor.math"), content: msg.slice(0, 500), timestamp,
      }]);
    }
  }, [t]);

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
      setActiveThinking(null);

      // Parse message for monitor
      const msg = data.message || "";
      if (msg.includes("```") || (data.toolsUsed && data.toolsUsed.length > 0)) {
        parseAndAddMonitorItem(msg, data.toolsUsed);
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
      setActiveThinking(null);
    },
  });

  // Clear chat when switching conversations
  useEffect(() => {
    setMessages([]);
    setMonitorItems([]);
    setActiveConversationId(conversationId);
    if (conversationId) {
      utils.chat.getConversation.invalidate({ conversationId });
    }
  }, [conversationId]);

  // Load conversation messages from query
  useEffect(() => {
    if (conversationData?.messages && activeConversationId) {
      setMessages(conversationData.messages.map((m) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      })));
    }
  }, [conversationData, activeConversationId]);


  // Update activeThinking when isLoading changes
  useEffect(() => {
    if (isLoading) {
      setActiveThinking(loadingStep || t("chat.thinking"));
    } else {
      setActiveThinking(null);
    }
  }, [isLoading, loadingStep, t]);

  // Mouth amplitude from audio analyser
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let animFrame: number;

    const setupAnalyser = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
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
      if (!analyserRef.current || audio.paused || audio.ended) {
        setMouthOpen(0);
        return;
      }
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 2; i < 40; i++) sum += dataArray[i];
      const avg = sum / 38;
      const normalized = Math.max(0, (avg - 45) / 100);
      const clamped = Math.min(0.4, normalized * 0.5);
      setMouthOpen((prev) => prev * 0.7 + clamped * 0.3);
      animFrame = requestAnimationFrame(animateMouth);
    };

    const onPlay = () => {
      try {
        setupAnalyser();
        if (audioContextRef.current?.state === "suspended") audioContextRef.current.resume();
      } catch {}
      animateMouth();
    };
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

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (camStream) {
        camStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [camStream]);

  // ========== VAD: Simple volume-based detection ==========
  const startVAD = useCallback((stream: MediaStream, onSilence: () => void) => {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      audioAnalyserRef.current = analyser;

      const SILENCE_THRESHOLD = 10;
      const SILENCE_DURATION = 1500;

      const check = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (avg < SILENCE_THRESHOLD) {
          if (!vadTimerRef.current) {
            vadTimerRef.current = setTimeout(() => {
              onSilence();
            }, SILENCE_DURATION);
          }
        } else {
          if (vadTimerRef.current) {
            clearTimeout(vadTimerRef.current);
            vadTimerRef.current = null;
          }
        }
      };

      const interval = setInterval(check, 100);
      micStreamRef.current = stream;
      return () => {
        clearInterval(interval);
        ctx.close().catch(() => {});
        if (vadTimerRef.current) clearTimeout(vadTimerRef.current);
        vadTimerRef.current = null;
      };
    } catch {
      return () => {};
    }
  }, []);

  // ========== REAL MIC FUNCTIONS ==========
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "";
      for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg", ""]) {
        if (type === "" || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size < 100) {
          if (isLiveMode) startRecording();
          return;
        }

        setIsLoading(true);
        setLoadingStep(t("chat.thinking"));
        try {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
          });
          reader.readAsDataURL(audioBlob);
          const audioBase64 = await base64Promise;

          const { text } = await liveAudioMutation.mutateAsync({ audioBase64, mimeType: "audio/webm" });

          if (text && text.trim().length > 0) {
            setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: `ðŸŽ¤ ${text}`, createdAt: new Date() }]);
            const voiceHistoryForApi = messages.filter((m: any) => m.role !== "system").slice(-20).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content || "" }));
            await sendMessageMutation.mutateAsync({
              conversationId: activeConversationId || undefined,
              message: text,
              avatar: selectedAvatar,
              history: voiceHistoryForApi,
              location: userLocation ? { lat: userLocation.lat, lon: userLocation.lon, city: userLocation.city } : undefined,
            });
          }
        } catch (err: any) {
          console.error("Live voice error:", err);
        } finally {
          setIsLoading(false);
          setLoadingStep("");
          if (isLiveMode) {
            setTimeout(() => startRecording(), 300);
          }
        }
      };

      // Start VAD for auto-stop
      const stopVAD = startVAD(stream, () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
        }
        stopVAD();
      });

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setIsLiveMode(false);
      alert("Microphone access denied.");
    }
  }, [activeConversationId, selectedAvatar, uploadAudioMutation, transcribeAudioMutation, sendMessageMutation, isLiveMode, startVAD, t]);

  const stopRecording = useCallback((shouldProcess = true) => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (!shouldProcess) {
        mediaRecorderRef.current.ondataavailable = null;
      }
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (vadTimerRef.current) {
      clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  const handleMicClick = useCallback(() => {
    if (isRecording || isLiveMode) {
      setIsLiveMode(false);
      stopRecording();
    } else {
      setIsLiveMode(true);
      startRecording();
    }
  }, [isRecording, isLiveMode, startRecording, stopRecording]);

  // ========== Silent frame capture helper ==========
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }, []);

  // ========== CAM: Silent capture ==========
  const openCamera = useCallback(async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      }
      setCamStream(stream);
      setIsCamOpen(true);
      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setTimeout(() => captureAndSendSilently(stream), 800);
        }
      }, 100);
    } catch {
      alert("Camera access denied. Please allow camera in your browser settings.");
    }
  }, []);

  const captureAndSendSilently = useCallback(async (stream: MediaStream) => {
    if (!videoRef.current || !canvasRef.current) return;

    const audioRecorder = new MediaRecorder(stream);
    const audioChunks: Blob[] = [];
    audioRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    audioRecorder.start();

    const imageBase64 = captureFrame();
    if (!imageBase64) return;

    setLoadingStep("Listening for prompt...");
    await new Promise(r => setTimeout(r, 1500));

    audioRecorder.stop();
    audioRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setCamStream(null);
      setIsCamOpen(false);

      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      setIsLoading(true);
      setLoadingStep(t("chat.analyzing"));

      try {
        const { imageUrl } = await uploadImageMutation.mutateAsync({ imageBase64, mimeType: "image/jpeg" });

        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        });
        reader.readAsDataURL(audioBlob);
        const audioBase64 = await base64Promise;

        const { audioUrl } = await uploadAudioMutation.mutateAsync({ audioBase64, mimeType: "audio/webm" });
        const { text } = await transcribeAudioMutation.mutateAsync({ audioUrl });

        const promptText = text || inputValue || "Analyze this.";
        setInputValue("");

        setMessages((prev) => [...prev, {
          id: Date.now(),
          role: "user",
          content: `ðŸ“· [Vision + Voice]: ${promptText}`,
          createdAt: new Date()
        }]);

        await sendMessageMutation.mutateAsync({
          conversationId: activeConversationId || undefined,
          message: promptText,
          avatar: selectedAvatar,
          imageUrl: imageUrl,
        });
      } catch (err: any) {
        setIsLoading(false);
        setLoadingStep("");
        setMessages((prev) => [...prev, { id: Date.now(), role: "assistant", content: `Error: ${err.message}`, createdAt: new Date() }]);
      }
    };
  }, [activeConversationId, selectedAvatar, inputValue, uploadImageMutation, uploadAudioMutation, transcribeAudioMutation, sendMessageMutation, captureFrame, t]);

  const closeCamera = useCallback(() => {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    setCamStream(null);
    setIsCamOpen(false);
  }, [camStream]);

  const handleCamClick = useCallback(() => {
    if (isCamOpen) {
      closeCamera();
    } else {
      openCamera();
    }
  }, [isCamOpen, openCamera, closeCamera]);

  // ========== SEND TEXT MESSAGE ==========
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMsg: Message = { id: Date.now(), role: "user", content: inputValue, createdAt: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setLoadingStep(t("chat.thinking"));
    const msgText = inputValue;
    setInputValue("");
    const msgLower = msgText.toLowerCase();
    const isSearchQuery = /\b(search|find|look up|what is|who is|when|where|news|weather|price|stock|score|latest|current|today|yesterday|recent|update|caut|gaseste|stir|vreme|pret|cine e|ce e|unde|cand|actual|azi|ieri)\b/i.test(msgText);
    setTimeout(() => setLoadingStep(isSearchQuery ? "🔍 Searching real-time data..." : "Analyzing..."), 800);
    setTimeout(() => setLoadingStep(isSearchQuery ? "📡 Updating with real info..." : "Processing..."), 2500);
    // Detectie generare imagine/video
    const isImageGen = /\b(generate|create|make|draw|design)\s+(an?\s+)?(image|picture|photo|illustration|artwork)\b/i.test(msgText);
    const isVideoGen = /\b(generate|create|make)\s+(a\s+)?(video|animation|clip)\b/i.test(msgText);

    if (isImageGen) {
      try {
        setLoadingStep("🎨 Generating image with Imagen 3...");
        const result = await generateImageMutation.mutateAsync({ prompt: msgText });
        setMessages((prev) => [...prev, {
          id: Date.now(), role: "assistant",
          content: `Here is your generated image:\n\n![Generated Image](${result.imageUrl})`,
          createdAt: new Date(),
        }]);
        setMonitorItems((prev) => [...prev, {
          id: `img-${Date.now()}`, type: "vision", title: "Generated Image",
          content: result.imageUrl, timestamp: new Date(),
        }]);
        setIsLoading(false); setLoadingStep(""); return;
      } catch (err: any) {
        setMessages((prev) => [...prev, { id: Date.now(), role: "assistant", content: `Image generation failed: ${err.message}`, createdAt: new Date() }]);
        setIsLoading(false); setLoadingStep(""); return;
      }
    }

    if (isVideoGen) {
      try {
        setLoadingStep("🎬 Generating video with Veo 2 (this takes ~60s)...");
        const result = await generateVideoMutation.mutateAsync({ prompt: msgText });
        setMessages((prev) => [...prev, {
          id: Date.now(), role: "assistant",
          content: `Here is your generated video:\n\n[Watch Video](${result.videoUrl})`,
          createdAt: new Date(),
        }]);
        setIsLoading(false); setLoadingStep(""); return;
      } catch (err: any) {
        setMessages((prev) => [...prev, { id: Date.now(), role: "assistant", content: `Video generation failed: ${err.message}`, createdAt: new Date() }]);
        setIsLoading(false); setLoadingStep(""); return;
      }
    }

    const historyForApi = messages.filter((m: any) => m.role !== "system").slice(-20).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content || "" }));
    await sendMessageMutation.mutateAsync({
      conversationId: activeConversationId || undefined,
      message: msgText,
      avatar: selectedAvatar,
      history: historyForApi,
      location: userLocation ? { lat: userLocation.lat, lon: userLocation.lon, city: userLocation.city } : undefined,
    });
  };

  const handleNewChat = () => {
    setMessages([]);
    setMonitorItems([]);
    setActiveConversationId(null);
    navigate("/chat");
  };

  const handleLogout = async () => { logout(); };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <PermissionsGate>
    <div className="w-full h-screen flex flex-col overflow-hidden relative" style={{ background: "#0c0e1a" }}>
      <audio ref={audioRef} className="hidden" crossOrigin="anonymous" />
      {/* Hidden camera elements for silent capture */}
      <video ref={videoRef} className="hidden" autoPlay muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* ===== TOP BAR ===== */}
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

          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-cyan-400 transition-colors"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {t("chat.newChat")}
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>

          {/* Monitor toggle */}
          <button
            onClick={() => setShowMonitor(!showMonitor)}
            className={`p-2 rounded-lg transition-colors ${showMonitor ? "text-blue-400 bg-blue-400/10" : "text-slate-400 hover:text-blue-400"}`}
            title="Toggle Monitor"
          >
            <Monitor className="w-4 h-4" />
          </button>

          {/* Memory toggle */}
          <button
            onClick={() => setShowMemory(!showMemory)}
            className={`p-2 rounded-lg transition-colors ${showMemory ? "text-purple-400 bg-purple-400/10" : "text-slate-400 hover:text-purple-400"}`}
            title="Toggle Memory"
          >
            <Brain className="w-4 h-4" />
          </button>

          {/* Theme toggle */}
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-slate-400 hover:text-yellow-400 transition-colors"
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}

          {user ? (
            <>
              <button onClick={() => navigate("/profile")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-white transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{user.name?.split(" ")[0]}</span>
              </button>

              <button onClick={handleLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-red-400 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </>
          ) : (
            <a href={getLoginUrl() || "#"} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm text-white transition-colors" style={{ background: "#4f46e5" }}>
              <User className="w-3.5 h-3.5" />
              Login
            </a>
          )}
        </div>
      </header>

      {/* ===== HISTORY DRAWER ===== */}
      {showHistory && (
        <div className="absolute inset-0 z-40 flex" style={{ top: '48px' }}>
          <div className="w-72 h-full overflow-y-auto py-3 px-2" style={{ background: '#0f1120', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between px-2 mb-3">
              <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">Chat History</span>
              <button onClick={() => setShowHistory(false)} className="text-xs text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {conversationsList && conversationsList.length > 0 ? conversationsList.map((conv: any) => (
              <button
                key={conv.id}
                onClick={() => { navigate(`/chat/${conv.id}`); setShowHistory(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 text-xs transition-colors ${
                  activeConversationId === conv.id ? 'text-cyan-300' : 'text-slate-400 hover:text-white'
                }`}
                style={{
                  background: activeConversationId === conv.id ? 'rgba(8,145,178,0.15)' : 'transparent',
                  border: activeConversationId === conv.id ? '1px solid rgba(8,145,178,0.2)' : '1px solid transparent',
                }}
              >
                <div className="font-medium truncate">{conv.title || 'Untitled'}</div>
                <div className="text-[10px] text-slate-600 mt-0.5">{new Date(conv.createdAt).toLocaleDateString()}</div>
              </button>
            )) : (
              <p className="text-xs text-slate-600 px-3">No conversations yet</p>
            )}
          </div>
          <div className="flex-1" onClick={() => setShowHistory(false)} />
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Monitor Panel 60% */}
        {showMonitor && (
          <div className="flex-[6] shrink-0 min-w-0 overflow-hidden">
            <MonitorPanel items={monitorItems} isVisible={showMonitor} activeThinking={isLoading ? activeThinking : null} />
          </div>
        )}
        {/* RIGHT: Avatar 40% + Chat 1 linie */}
        <div className="flex-[4] flex flex-col min-w-0 overflow-hidden" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex-1 relative overflow-hidden">
            <div className="absolute inset-0 overflow-hidden" style={{
              backgroundImage: `url(${CITY_BOKEH_BG})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}>
              <div className="absolute top-3 left-4 z-10">
                <span className="text-cyan-400 font-semibold text-base" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
                  {selectedAvatar === "kelion" ? "Kelion" : "Kira"}
                </span>
              </div>
              {isCamOpen && (
                <div className="absolute top-3 right-4 z-10 flex items-center gap-2 bg-cyan-900/30 border border-cyan-500/30 rounded-full px-3 py-1">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs text-cyan-400">Capturing...</span>
                </div>
              )}
              <div className="w-full h-full">
                <Avatar3D
                  character={selectedAvatar}
                  isAnimating={isLoading}
                  emotion={isLoading ? "thinking" : "neutral"}
                  mouthOpen={mouthOpen}
                />
                <style>{`.avatar-container canvas { background: transparent !important; }`}</style>
              </div>
            </div>
          </div>
          <div className="h-10 px-3 flex items-center shrink-0 gap-2" style={{
            background: "rgba(0,0,0,0.6)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            {isLoading ? (
              <>
                {loadingStep?.startsWith("🔍") || loadingStep?.startsWith("📡") ? (
                  <svg className="w-3 h-3 shrink-0 text-yellow-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                ) : (
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
                )}
                <span className={`text-xs animate-pulse truncate ${loadingStep?.startsWith("🔍") || loadingStep?.startsWith("📡") ? "text-yellow-400" : "text-cyan-400"}`}>{activeThinking || loadingStep || "Working..."}</span>
              </>
            ) : lastMessage ? (
              <span className="text-xs text-slate-300 truncate">
                <span className="opacity-50">{lastMessage.role === "user" ? "You: " : (selectedAvatar === "kelion" ? "Kelion: " : "Kira: ")}</span>
                {lastMessage.content}
              </span>
            ) : (
              <span className="text-xs text-slate-600 italic">Start a conversation...</span>
            )}
          </div>
        </div>
      </div>

      {/* Memory Panel â€” overlay */}
      <MemoryPanel isOpen={showMemory} onClose={() => setShowMemory(false)} />

      {/* ===== BOTTOM BAR: CAM | MIC | Input | SEND ===== */}
      <div className="px-4 py-2.5 shrink-0 flex items-center gap-2" style={{ background: "#0c0e1a", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {/* CAM button - silent capture */}
        <button
          onClick={handleCamClick}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
            isCamOpen ? "text-cyan-300" : "text-slate-400 hover:text-cyan-400"
          }`}
          style={{
            border: isCamOpen ? "1px solid rgba(8,145,178,0.4)" : "1px solid rgba(255,255,255,0.1)",
            background: isCamOpen ? "rgba(8,145,178,0.15)" : "transparent",
          }}
          aria-label={isCamOpen ? t("chat.cameraOff") : t("chat.cameraOn")}
        >
          {isCamOpen ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          <span>{isCamOpen ? "CLOSE" : "CAM"}</span>
        </button>

        {/* MIC button - LIVE VOICE MODE */}
        <button
          onClick={handleMicClick}
          disabled={isLoading && !isRecording && !isLiveMode}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all ${
            isLiveMode || isRecording ? "text-cyan-400 font-bold" : "text-slate-400 hover:text-cyan-400"
          }`}
          style={{
            border: isLiveMode || isRecording ? "1px solid rgba(8,145,178,0.5)" : "1px solid rgba(255,255,255,0.1)",
            background: isLiveMode || isRecording ? "rgba(8,145,178,0.1)" : "transparent",
            boxShadow: isLiveMode || isRecording ? "0 0 10px rgba(8,145,178,0.2)" : "none",
          }}
          aria-label={isLiveMode || isRecording ? t("chat.voiceOff") : t("chat.voiceOn")}
        >
          {isLiveMode || isRecording ? (
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-1 bg-cyan-400 rounded-full animate-bounce" style={{ height: i*4+'px', animationDelay: i*0.1+'s' }} />
                ))}
              </div>
              <span className="animate-pulse">{isLiveMode ? "LIVE CHAT" : formatTime(recordingTime)}</span>
            </div>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              <span>LIVE CHAT</span>
            </>
          )}
        </button>

        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
          placeholder={t("chat.placeholder")}
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
          aria-label={t("chat.send")}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{t("chat.send")}</span>
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
    </PermissionsGate>
  );
}


