import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Plus, MessageSquare } from "lucide-react";
import { Streamdown } from "streamdown";
import { useRoute } from "wouter";
import { VoiceRecorder, VoicePlayer } from "@/components/VoiceRecorder";
import { Avatar3D } from "@/components/Avatar3D";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  aiModel?: string | null;
  createdAt: Date;
}

export default function Chat() {
  const { user } = useAuth();
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId ? parseInt(params.conversationId) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedAI, setSelectedAI] = useState<"gpt-4" | "gemini" | "groq" | "claude" | "deepseek">("gpt-4");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<"kelion" | "kira">("kelion");
  const [showAvatar, setShowAvatar] = useState(true);
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

    // Add user message to UI
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

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Please log in to access the chat</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <Button onClick={handleNewConversation} className="w-full mb-4" variant="default">
          <Plus className="w-4 h-4 mr-2" />
          New Chat
        </Button>

        {/* Avatar Selection */}
        <div className="mb-4 p-3 bg-purple-900/20 rounded-lg">
          <p className="text-xs text-gray-400 mb-2">Avatar</p>
          <div className="flex gap-2">
            <Button
              onClick={() => setSelectedAvatar("kelion")}
              size="sm"
              variant={selectedAvatar === "kelion" ? "default" : "outline"}
              className="flex-1 text-xs"
            >
              Kelion
            </Button>
            <Button
              onClick={() => setSelectedAvatar("kira")}
              size="sm"
              variant={selectedAvatar === "kira" ? "default" : "outline"}
              className="flex-1 text-xs"
            >
              Kira
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {conversations?.map((conv) => (
            <a
              key={conv.id}
              href={`/chat/${conv.id}`}
              className={`block p-3 rounded-lg truncate text-sm transition-colors ${
                conversationId === conv.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-foreground"
              }`}
            >
              <MessageSquare className="w-4 h-4 inline mr-2" />
              {conv.title}
            </a>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card p-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">KelionAI Chat</h1>
            <p className="text-xs text-gray-400">Chat with {selectedAI.toUpperCase()}</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowAvatar(!showAvatar)}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              {showAvatar ? "Hide" : "Show"} Avatar
            </Button>
            <select
              value={selectedAI}
              onChange={(e) => setSelectedAI(e.target.value as any)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gemini">Gemini</option>
              <option value="groq">Groq</option>
              <option value="claude">Claude</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>
        </div>

        {/* Avatar Display */}
        {showAvatar && (
          <div className="border-b border-border bg-card p-4 flex justify-center">
            <Avatar3D character={selectedAvatar} isAnimating={isLoading} emotion={isLoading ? "thinking" : "neutral"} />
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Start a conversation by typing a message below</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <Card
                  className={`max-w-md lg:max-w-2xl p-4 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-foreground"
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
              <Card className="bg-card p-4">
                <Loader2 className="w-5 h-5 animate-spin" />
              </Card>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-border bg-card p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Type your message..."
              disabled={isLoading || !conversationId}
              className="flex-1"
            />
            <Button
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim() || !conversationId}
              variant="default"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex gap-2">
            <VoiceRecorder
              onRecordingComplete={(audioUrl) => {
                console.log("Recording complete:", audioUrl);
                // TODO: Implement voice transcription and sending
              }}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
