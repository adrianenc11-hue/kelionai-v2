import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, Send, Mic, MicOff, Camera, CameraOff, LogOut, User, CreditCard, X, History } from "lucide-react";
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
  const [showHistory, setShowHistory] = useState(false);

  // MIC state - REAL recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // CAM state - REAL camera
  const [isCamOpen, setIsCamOpen] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
          setMonitorContent({ type: "search", data: msg, title: "Search Results" });
        } else if (data.toolsUsed?.includes("analyze_image")) {
          setMonitorContent({ type: "vision", data: msg, title: "Vision Analysis" });
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

  // Clear chat when switching conversations - MUST run before data load
  useEffect(() => {
    // Always sync activeConversationId with URL param
    setMessages([]);
    setMonitorContent(null);
    setActiveConversationId(conversationId);
    // Invalidate old query cache so stale data doesn't repopulate
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

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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
      const normalized = Math.max(0, (avg - 30) / 120);
      const clamped = Math.min(1, normalized * 1.8);
      setMouthOpen((prev) => prev * 0.3 + clamped * 0.7);
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

  // ========== REAL MIC FUNCTIONS ==========
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Find best supported MIME type
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
        if (audioBlob.size < 100) return; // too small, ignore

        // Pipeline: upload → transcribe → send to brain
        setIsLoading(true);
        setLoadingStep("Uploading audio...");
        try {
          // Convert blob to base64
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(",")[1];
              resolve(base64);
            };
          });
          reader.readAsDataURL(audioBlob);
          const audioBase64 = await base64Promise;

          // Step 1: Upload to S3
          setLoadingStep("Uploading audio...");
          const { audioUrl } = await uploadAudioMutation.mutateAsync({
            audioBase64,
            mimeType: "audio/webm",
          });

          // Step 2: Transcribe with Whisper
          setLoadingStep("Transcribing speech...");
          const { text, language } = await transcribeAudioMutation.mutateAsync({
            audioUrl,
          });

          if (!text || text.trim().length === 0) {
            setIsLoading(false);
            setLoadingStep("");
            setMessages((prev) => [...prev, {
              id: Date.now(),
              role: "system",
              content: "Could not understand audio. Please try again.",
              createdAt: new Date(),
            }]);
            return;
          }

          // Step 3: Show transcribed text as user message
          const userMsg: Message = {
            id: Date.now(),
            role: "user",
            content: `🎤 ${text}`,
            createdAt: new Date(),
          };
          setMessages((prev) => [...prev, userMsg]);

          // Step 4: Send to Brain
          setLoadingStep("Thinking...");
          setTimeout(() => setLoadingStep("Processing..."), 1500);
          await sendMessageMutation.mutateAsync({
            conversationId: activeConversationId || undefined,
            message: text,
            avatar: selectedAvatar,
          });
        } catch (err: any) {
          setIsLoading(false);
          setLoadingStep("");
          setMessages((prev) => [...prev, {
            id: Date.now(),
            role: "assistant",
            content: `Voice error: ${err.message}`,
            createdAt: new Date(),
          }]);
        }
      };

      mediaRecorder.start(250); // collect chunks every 250ms
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);

      // Timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      alert("Microphone access denied. Please allow microphone in your browser settings.");
    }
  }, [activeConversationId, selectedAvatar, uploadAudioMutation, transcribeAudioMutation, sendMessageMutation]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ========== REAL CAM FUNCTIONS ==========
  const openCamera = useCallback(async () => {
    try {
      let stream: MediaStream;
      try {
        // Try back camera first (mobile)
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        // Fallback to any camera (front/desktop)
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }
      setCamStream(stream);
      setIsCamOpen(true);
      // Attach to video element after state update
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err: any) {
      alert("Camera access denied. Please allow camera in your browser settings.");
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      setCamStream(null);
    }
    setIsCamOpen(false);
  }, [camStream]);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    // Wait for video to be ready if not yet
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        setTimeout(resolve, 2000); // timeout fallback
      });
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Convert to base64 JPEG
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const imageBase64 = dataUrl.split(",")[1];

    // Close camera after capture
    closeCamera();

    // Pipeline: upload → send to brain with vision
    setIsLoading(true);
    setLoadingStep("Uploading image...");
    try {
      // Step 1: Upload to S3
      const { imageUrl } = await uploadImageMutation.mutateAsync({
        imageBase64,
        mimeType: "image/jpeg",
      });

      // Step 2: Show capture as user message
      const userMsg: Message = {
        id: Date.now(),
        role: "user",
        content: `📷 [Camera capture sent for analysis]`,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Step 3: Send to Brain with imageUrl for GPT vision
      setLoadingStep("Analyzing image with AI vision...");
      const question = inputValue.trim() || "Describe what you see in detail. If there are any dangers or important things, mention them first.";
      setInputValue("");

      await sendMessageMutation.mutateAsync({
        conversationId: activeConversationId || undefined,
        message: question,
        avatar: selectedAvatar,
        imageUrl: imageUrl,
      });
    } catch (err: any) {
      setIsLoading(false);
      setLoadingStep("");
      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: "assistant",
        content: `Camera error: ${err.message}`,
        createdAt: new Date(),
      }]);
    }
  }, [activeConversationId, selectedAvatar, inputValue, closeCamera, uploadImageMutation, sendMessageMutation]);

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

  const handleNewChat = () => {
    setMessages([]);
    setMonitorContent(null);
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
    <div className="w-full h-screen flex flex-col overflow-hidden relative" style={{ background: "#0c0e1a" }}>
      <audio ref={audioRef} className="hidden" crossOrigin="anonymous" />
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
            New Chat
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>

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
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Presentation Monitor */}
        <div className="flex-1 flex flex-col" style={{ background: "#0f1120" }}>
          <div className="flex-1 flex items-center justify-center overflow-auto p-6">
            {/* Camera preview overlay on monitor */}
            {isCamOpen ? (
              <div className="w-full max-w-2xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">Live Camera</span>
                  <button onClick={closeCamera} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                    <X className="w-3 h-3" /> Close
                  </button>
                </div>
                <div className="relative rounded-xl overflow-hidden" style={{ border: "2px solid rgba(8,145,178,0.3)" }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full rounded-xl"
                    style={{ maxHeight: "400px", objectFit: "cover" }}
                  />
                  <button
                    onClick={captureAndAnalyze}
                    disabled={isLoading}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #0891b2, #4f46e5)", boxShadow: "0 4px 20px rgba(8,145,178,0.4)" }}
                  >
                    📸 Capture & Analyze
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Type a question in the input below, then click Capture. Or just capture and AI will describe what it sees.
                </p>
              </div>
            ) : monitorContent ? (
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
                <p className="text-sm text-slate-500 mb-1">Presentation Monitor</p>
                <p className="text-xs text-slate-700">Ask for a map, image, weather, search, or code</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Avatar FULL HEIGHT with chat overlay at bottom */}
        <div className="w-[55%] min-w-[400px] max-w-[700px] shrink-0 flex flex-col relative" style={{
          borderLeft: "1px solid rgba(255,255,255,0.05)",
        }}>
          {/* Avatar area - FULL HEIGHT of right panel */}
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

          {/* Chat messages - OVERLAY at bottom of avatar */}
          <div className="absolute bottom-0 left-0 right-0 max-h-[40%] overflow-y-auto px-3 py-2 space-y-2 z-20" style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)",
          }}>
            {messages.length === 0 && !isLoading && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-slate-600 italic">Start a conversation...</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === "user" ? "text-cyan-100" :
                  msg.role === "system" ? "text-yellow-300 italic" :
                  "text-slate-300"
                }`} style={{
                  background: msg.role === "user" ? "rgba(8,145,178,0.15)" :
                    msg.role === "system" ? "rgba(234,179,8,0.1)" :
                    "rgba(255,255,255,0.04)",
                  border: `1px solid ${msg.role === "user" ? "rgba(8,145,178,0.2)" :
                    msg.role === "system" ? "rgba(234,179,8,0.2)" :
                    "rgba(255,255,255,0.05)"}`,
                }}>
                  <Streamdown>{msg.content || ""}</Streamdown>
                  {msg.confidence && (
                    <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full ${
                      msg.confidence === "verified" ? "bg-green-900/30 text-green-400" :
                      msg.confidence === "high" ? "bg-blue-900/30 text-blue-400" :
                      msg.confidence === "medium" ? "bg-yellow-900/30 text-yellow-400" :
                      "bg-red-900/30 text-red-400"
                    }`}>
                      {msg.confidence}
                    </span>
                  )}
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
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>

      {/* ===== BOTTOM BAR: CAM | MIC | Input | SEND ===== */}
      <div className="px-4 py-2.5 shrink-0 flex items-center gap-2" style={{ background: "#0c0e1a", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {/* CAM button - REAL */}
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
          aria-label="Camera"
        >
          {isCamOpen ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          <span>{isCamOpen ? "CLOSE" : "CAM"}</span>
        </button>

        {/* MIC button - REAL */}
        <button
          onClick={handleMicClick}
          disabled={isLoading && !isRecording}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
            isRecording ? "text-red-300" : "text-slate-400 hover:text-cyan-400"
          }`}
          style={{
            border: isRecording ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.1)",
            background: isRecording ? "rgba(239,68,68,0.15)" : "transparent",
            animation: isRecording ? "pulse 1.5s ease-in-out infinite" : "none",
          }}
          aria-label="Microphone"
        >
          {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          <span>{isRecording ? `STOP ${formatTime(recordingTime)}` : "MIC"}</span>
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

      {/* Recording pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
