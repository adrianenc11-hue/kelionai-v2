import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Plus, MessageSquare, Video, Mic } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute, useLocation } from "wouter";
import { VoiceRecorder, VoicePlayer } from "@/components/VoiceRecorder";
import Avatar3D from "@/components/Avatar3D";
import WebcamFeed from "@/components/WebcamFeed";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  aiModel?: string | null;
  createdAt: Date;
}

export default function Chat() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId ? parseInt(params.conversationId) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedAI, setSelectedAI] = useState<"gpt-4" | "gemini" | "groq" | "claude" | "deepseek">("gpt-4");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<"kelion" | "kira">("kelion");
  const [voiceVolume, setVoiceVolume] = useState(60);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const { data: conversations } = trpc.chat.listConversations.useQuery();
  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { conversationId: conversationId || 0 },
    { enabled: !!conversationId }
  );

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: data.message,
          aiModel: data.provider,
          createdAt: new Date(),
        },
      ]);
      setInputValue("");
      setIsLoading(false);
      utils.chat.getConversation.invalidate();
    },
    onError: (error) => {
      console.error("Failed to send message:", error);
      setIsLoading(false);
    },
  });

  const createConversationMutation = trpc.chat.createConversation.useMutation({
    onSuccess: () => {
      utils.chat.listConversations.invalidate();
    },
  });

  useEffect(() => {
    if (conversationData?.messages) {
      setMessages(
        conversationData.messages.map((m) => ({
          ...m,
          createdAt: new Date(m.createdAt),
        }))
      );
    }
  }, [conversationData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !conversationId || isLoading) return;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: "user",
        content: inputValue,
        createdAt: new Date(),
      },
    ]);

    setIsLoading(true);
    await sendMessageMutation.mutateAsync({
      conversationId,
      message: inputValue,
      aiProvider: selectedAI,
    });
  };

  const handleNewConversation = async () => {
    await createConversationMutation.mutateAsync({
      title: `Chat - ${new Date().toLocaleDateString()}`,
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Please log in to access the chat</p>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/50 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-blue-400">KelionAI</div>
          <div className="text-xs text-slate-400">v2.5.1</div>
          <div className="flex items-center gap-2 ml-4">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-slate-400">Online</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Avatar Selector */}
          <div className="flex gap-2">
            <Button
              onClick={() => setSelectedAvatar("kelion")}
              variant={selectedAvatar === "kelion" ? "default" : "outline"}
              className="px-4"
            >
              Kelion
            </Button>
            <Button
              onClick={() => setSelectedAvatar("kira")}
              variant={selectedAvatar === "kira" ? "default" : "outline"}
              className="px-4"
            >
              Kira
            </Button>
          </div>

          {/* AI Provider Selector */}
          <select
            value={selectedAI}
            onChange={(e) => setSelectedAI(e.target.value as any)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
          >
            <option value="gpt-4">GPT-4</option>
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
            <option value="claude">Claude</option>
            <option value="deepseek">DeepSeek</option>
          </select>

          {/* Settings & Logout */}
          <Button variant="ghost" size="icon">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Button>

          <Button
            onClick={handleLogout}
            variant="ghost"
            className="text-slate-400 hover:text-white"
          >
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side - Chat Area */}
        <div className="flex-1 flex flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-slate-500 mb-2">
                    <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-slate-400 text-lg font-medium mb-2">Monitor de prezentare</h3>
                  <p className="text-slate-500 text-sm">Cere o hartă, imagine, vreme, cântare sau cod</p>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <Card
                    className={`max-w-xs lg:max-w-md p-4 ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white border-0"
                        : "bg-slate-800 text-slate-100 border-slate-700"
                    }`}
                  >
                    {msg.aiModel && msg.role === "assistant" && (
                      <p className="text-xs opacity-70 mb-2">via {msg.aiModel}</p>
                    )}
                    <Streamdown>{msg.content || ""}</Streamdown>
                  </Card>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <Card className="bg-slate-800 border-slate-700 p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                </Card>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice Control Slider */}
          <div className="border-t border-slate-800 px-6 py-4 bg-slate-950/50">
            <div className="flex items-center gap-4 bg-slate-800/50 border border-slate-700 rounded-full px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                </svg>
                <span className="text-sm text-slate-400">Gură</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={voiceVolume}
                onChange={(e) => setVoiceVolume(parseInt(e.target.value))}
                className="flex-1 h-1 bg-slate-700 rounded-full appearance-none cursor-pointer"
              />
              <span className="text-sm font-medium text-slate-300 min-w-12">{voiceVolume}%</span>
              <Button size="sm" variant="outline" className="px-3">
                Test
              </Button>
              <Button size="sm" className="px-3 bg-green-600 hover:bg-green-700">
                OK
              </Button>
            </div>
          </div>

          {/* Input Area */}
          <div className="border-t border-slate-800 px-6 py-4 bg-slate-950/50 space-y-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Video className="w-4 h-4" />
                CAM
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Mic className="w-4 h-4" />
                MIC
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder="Type or speak..."
                disabled={isLoading || !conversationId}
                className="flex-1 bg-slate-800 border-slate-700 text-white placeholder-slate-500"
              />
              <Button
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim() || !conversationId}
                className="bg-blue-600 hover:bg-blue-700 gap-2"
              >
                <Send className="w-4 h-4" />
                SEND
              </Button>
            </div>
          </div>
        </div>

        {/* Right Side - Avatar */}
        <div className="w-96 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-l border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Background effect */}
          <div className="absolute inset-0 bg-gradient-to-t from-blue-900/20 via-transparent to-transparent pointer-events-none" />

          {/* Avatar name */}
          <div className="absolute top-6 left-6 text-lg font-semibold text-blue-400 z-10">
            {selectedAvatar.charAt(0).toUpperCase() + selectedAvatar.slice(1)}
          </div>

          {/* Hidden Camera Feed - Connected to AGI Brain */}
          <div className="hidden">
            <WebcamFeed
              isActive={true}
              onFrameCapture={(canvas) => {
                // Send frame to AGI brain for analysis
              }}
            />
          </div>

          {/* 3D Avatar */}
          <div className="w-full h-full relative">
            <Avatar3D character={selectedAvatar} isAnimating={isLoading} emotion={isLoading ? "thinking" : "neutral"} />
          </div>
        </div>
      </div>
    </div>
  );
}
