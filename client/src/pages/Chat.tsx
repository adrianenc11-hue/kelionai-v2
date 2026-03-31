import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Plus, MessageSquare, Video, Mic, MicOff, Volume2 } from "lucide-react";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const utils = trpc.useUtils();
  const { data: conversations } = trpc.chat.listConversations.useQuery();
  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { conversationId: activeConversationId || 0 },
    { enabled: !!activeConversationId }
  );

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      // Update active conversation if auto-created
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

      // Handle voice cloning trigger
      if (data.voiceCloningStep) {
        setVoiceCloning({
          active: true,
          step: data.voiceCloningStep.step,
          sampleText: data.voiceCloningStep.sampleText,
          recording: false,
          audioChunks: [],
        });
      }

      // Auto-play audio if available
      if (data.audioUrl && autoPlayAudio && audioRef.current) {
        audioRef.current.src = data.audioUrl;
        audioRef.current.play().catch(() => {});
      }

      utils.chat.listConversations.invalidate();
    },
    onError: (error) => {
      console.error("Failed to send message:", error);
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: inputValue,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setLoadingStep("Thinking...");

    const msgText = inputValue;
    setInputValue("");

    // Simulate progress steps
    setTimeout(() => setLoadingStep("Analyzing your message..."), 800);
    setTimeout(() => setLoadingStep("Processing with Brain v4..."), 2000);

    await sendMessageMutation.mutateAsync({
      conversationId: activeConversationId || undefined,
      message: msgText,
      avatar: selectedAvatar,
    });
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    navigate("/chat");
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

          // Process cloning
          try {
            const result = await voiceCloningMutation.mutateAsync({ step: 4, audioBase64: base64 });
            setVoiceCloning((prev) => ({
              ...prev,
              step: result.step,
              sampleText: undefined,
            }));
            if (result.action === "confirm") {
              setMessages((prev) => [...prev, {
                id: Date.now(),
                role: "assistant",
                content: `Voice cloned successfully! ${result.description}`,
                createdAt: new Date(),
              }]);
            }
          } catch (err) {
            setMessages((prev) => [...prev, {
              id: Date.now(),
              role: "assistant",
              content: "Voice cloning failed. Please try again.",
              createdAt: new Date(),
            }]);
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

  const stopRecording = () => {
    voiceCloning.mediaRecorder?.stop();
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // Confidence badge
  const ConfidenceBadge = ({ level }: { level?: string }) => {
    if (!level) return null;
    const colors: Record<string, string> = {
      verified: "bg-green-500/20 text-green-400 border-green-500/30",
      high: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      low: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    const labels: Record<string, string> = {
      verified: "Verified",
      high: "High confidence",
      medium: "Medium confidence",
      low: "Low confidence",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[level] || ""}`} aria-label={`Confidence: ${labels[level]}`}>
        {level === "verified" ? "✓ " : ""}{labels[level] || level}
      </span>
    );
  };

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
    <div className="w-full h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col" role="main" aria-label="KelionAI Chat">
      {/* Hidden audio player for TTS */}
      <audio ref={audioRef} className="hidden" />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur px-4 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold text-blue-400">KelionAI</h1>
          <span className="text-xs text-slate-500">v4.0</span>
          <div className="flex items-center gap-1.5 ml-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" aria-hidden="true" />
            <span className="text-xs text-slate-400">Online</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoPlayAudio(!autoPlayAudio)}
            className={autoPlayAudio ? "text-blue-400" : "text-slate-500"}
            aria-label={autoPlayAudio ? "Disable auto-play audio" : "Enable auto-play audio"}
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <Button onClick={handleLogout} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Conversations */}
        <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col hidden md:flex" aria-label="Conversations">
          <div className="p-3">
            <Button onClick={handleNewConversation} className="w-full bg-blue-600 hover:bg-blue-700 gap-2" size="sm">
              <Plus className="w-4 h-4" /> New Chat
            </Button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 space-y-1" aria-label="Chat history">
            {conversations?.map((conv) => (
              <button
                key={conv.id}
                onClick={() => { setActiveConversationId(conv.id); navigate(`/chat/${conv.id}`); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  activeConversationId === conv.id
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
                aria-current={activeConversationId === conv.id ? "page" : undefined}
              >
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="truncate">{conv.title}</span>
              </button>
            ))}
            {(!conversations || conversations.length === 0) && (
              <p className="text-slate-600 text-xs text-center py-4">No conversations yet. Start a new chat!</p>
            )}
          </nav>
        </aside>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" role="log" aria-label="Chat messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="text-6xl mb-4" aria-hidden="true">💬</div>
                  <h2 className="text-xl font-semibold text-slate-300 mb-3">Welcome to KelionAI</h2>
                  <p className="text-slate-500 mb-6 text-base">I can help you with anything. Just type or speak!</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["What's the weather?", "Teach me something", "Write Python code", "Clone my voice"].map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="outline"
                        size="sm"
                        className="text-xs border-slate-700 text-slate-400 hover:text-white hover:border-blue-500"
                        onClick={() => { setInputValue(suggestion); }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] lg:max-w-[60%] ${msg.role === "user" ? "" : ""}`}>
                    <Card
                      className={`p-4 ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white border-0"
                          : "bg-slate-800/80 text-slate-100 border-slate-700/50"
                      }`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-500">{selectedAvatar === "kelion" ? "Kelion" : "Kira"}</span>
                          <ConfidenceBadge level={msg.confidence} />
                          {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                            <span className="text-xs text-slate-600">
                              Tools: {msg.toolsUsed.join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-sm md:text-base leading-relaxed">
                        <Streamdown>{msg.content || ""}</Streamdown>
                      </div>
                      {msg.audioUrl && (
                        <button
                          onClick={() => { if (audioRef.current) { audioRef.current.src = msg.audioUrl!; audioRef.current.play(); } }}
                          className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                          aria-label="Play audio response"
                        >
                          <Volume2 className="w-3 h-3" /> Play audio
                        </button>
                      )}
                    </Card>
                  </div>
                </div>
              ))
            )}

            {/* Working indicator - hourglass */}
            {isLoading && (
              <div className="flex justify-start" role="status" aria-label="AI is working">
                <Card className="bg-slate-800/80 border-slate-700/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-blue-400 font-medium">{loadingStep || "Working..."}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Please wait, I'm processing your request</p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Voice Cloning UI */}
            {voiceCloning.active && (
              <div className="flex justify-start">
                <Card className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border-purple-500/30 p-5 max-w-lg">
                  <h3 className="text-lg font-bold text-purple-400 mb-2">
                    🎙️ Voice Cloning - Step {voiceCloning.step}/5
                  </h3>
                  {voiceCloning.step === 1 && (
                    <div>
                      <p className="text-sm text-slate-300 mb-3">Read the text below out loud in a quiet place:</p>
                      <div className="bg-slate-800 rounded-lg p-4 mb-3 text-sm text-slate-200 leading-relaxed border border-slate-700">
                        {voiceCloning.sampleText}
                      </div>
                      <Button onClick={() => { setVoiceCloning((prev) => ({ ...prev, step: 2 })); }} className="bg-purple-600 hover:bg-purple-700">
                        I'm Ready - Next Step
                      </Button>
                    </div>
                  )}
                  {voiceCloning.step === 2 && (
                    <div>
                      <p className="text-sm text-slate-300 mb-3">Press record and read the text above (30-60 seconds):</p>
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
                      <p className="text-sm text-green-400 mb-3">✅ Voice cloned successfully!</p>
                      <div className="flex gap-2">
                        <Button onClick={() => { setVoiceCloning((prev) => ({ ...prev, step: 5 })); }} className="bg-green-600 hover:bg-green-700">
                          Save Voice
                        </Button>
                        <Button onClick={() => { setVoiceCloning({ active: false, step: 0, recording: false, audioChunks: [] }); }} variant="outline">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  {voiceCloning.step === 5 && (
                    <div>
                      <p className="text-sm text-green-400">✅ Voice saved! The AI will now respond using your voice.</p>
                      <Button onClick={() => { setVoiceCloning({ active: false, step: 0, recording: false, audioChunks: [] }); }} variant="outline" size="sm" className="mt-2">
                        Close
                      </Button>
                    </div>
                  )}
                </Card>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-slate-800 px-4 md:px-6 py-3 bg-slate-950/80 backdrop-blur">
            <div className="flex items-center gap-2 max-w-4xl mx-auto">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                placeholder="Type your message... (or say 'clone my voice')"
                disabled={isLoading}
                className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-base py-5"
                aria-label="Message input"
              />
              <Button
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
                className="bg-blue-600 hover:bg-blue-700 shrink-0 h-10 w-10 p-0"
                aria-label="Send message"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Right Side - Avatar */}
        <aside className="w-72 lg:w-80 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-l border-slate-800 flex-col items-center hidden lg:flex" aria-label="AI Avatar">
          <div className="absolute top-16 left-0 right-0 flex items-center justify-center gap-3 px-4 z-10 py-3">
            <Button
              onClick={() => setSelectedAvatar("kelion")}
              variant={selectedAvatar === "kelion" ? "default" : "outline"}
              size="sm"
              className={selectedAvatar === "kelion" ? "bg-blue-600" : ""}
            >
              Kelion
            </Button>
            <Button
              onClick={() => setSelectedAvatar("kira")}
              variant={selectedAvatar === "kira" ? "default" : "outline"}
              size="sm"
              className={selectedAvatar === "kira" ? "bg-pink-600" : ""}
            >
              Kira
            </Button>
          </div>
          <div className="w-full h-full relative mt-12">
            <Avatar3D character={selectedAvatar} isAnimating={isLoading} emotion={isLoading ? "thinking" : "neutral"} />
          </div>
        </aside>
      </div>
    </div>
  );
}
