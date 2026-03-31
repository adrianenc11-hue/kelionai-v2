import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Mail, MessageSquare, Loader2, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

export default function Contact() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [aiResponse, setAiResponse] = useState("");

  const sendContactMutation = trpc.contact.sendMessage.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      if (data.aiResponse) {
        setAiResponse(data.aiResponse);
      }
      toast.success("Message sent successfully!");
    },
    onError: (error: { message: string }) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    await sendContactMutation.mutateAsync({ name, email, subject, message });
  };

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white flex flex-col">
      {/* Header with Back button */}
      <header className="shrink-0 border-b border-slate-800/50 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Button onClick={() => window.history.back()} variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">Contact Us</h1>
          <p className="text-slate-500 text-xs">We'd love to hear from you</p>
        </div>
      </header>

      {/* Content - centered, no scroll */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-lg">
          {!submitted ? (
            <Card className="bg-slate-900/80 border-slate-800 p-5">
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="contact-name">Name</label>
                    <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="bg-slate-800/60 border-slate-700 h-9 text-sm" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="contact-email">Email</label>
                    <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" className="bg-slate-800/60 border-slate-700 h-9 text-sm" required />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="contact-subject">Subject</label>
                  <Input id="contact-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" className="bg-slate-800/60 border-slate-700 h-9 text-sm" required />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="contact-message">Message</label>
                  <textarea
                    id="contact-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what you need help with..."
                    className="w-full h-24 px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-md text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    required
                  />
                </div>

                <Button type="submit" disabled={sendContactMutation.isPending} className="w-full bg-blue-600 hover:bg-blue-700 gap-2" size="sm">
                  {sendContactMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="w-4 h-4" /> Send Message</>
                  )}
                </Button>
              </form>

              <div className="mt-4 pt-3 border-t border-slate-800">
                <p className="text-xs text-slate-400 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" />
                  Or email us at <a href="mailto:contact@kelionai.app" className="text-blue-400 hover:underline">contact@kelionai.app</a>
                </p>
              </div>
            </Card>
          ) : (
            <Card className="bg-slate-900/80 border-slate-800 p-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <h2 className="text-lg font-bold text-green-400">Message Sent!</h2>
              <p className="text-slate-400 text-sm mt-1 mb-4">We'll get back to you soon.</p>

              {aiResponse && (
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 mb-4 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-blue-400">AI Response</span>
                  </div>
                  <p className="text-xs text-slate-300">{aiResponse}</p>
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <Button onClick={() => { setSubmitted(false); setSubject(""); setMessage(""); setAiResponse(""); }} variant="outline" size="sm" className="border-slate-700">
                  Send Another
                </Button>
                <Button onClick={() => window.history.back()} size="sm" className="bg-blue-600 hover:bg-blue-700">
                  Go Back
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
