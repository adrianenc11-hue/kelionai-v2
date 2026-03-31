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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white" role="main" aria-label="Contact page">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center gap-4">
          <Button onClick={() => setLocation("/")} variant="ghost" size="sm" aria-label="Go back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Contact Us</h1>
            <p className="text-slate-400 text-sm mt-1">We'd love to hear from you</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!submitted ? (
          <Card className="bg-slate-900/80 border-slate-800 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Send us a message</h2>
                <p className="text-sm text-slate-400">Our AI assistant will respond instantly, and our team will follow up</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1.5" htmlFor="contact-name">Name</label>
                  <Input
                    id="contact-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="bg-slate-800/60 border-slate-700"
                    required
                    aria-required="true"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1.5" htmlFor="contact-email">Email</label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="bg-slate-800/60 border-slate-700"
                    required
                    aria-required="true"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5" htmlFor="contact-subject">Subject</label>
                <Input
                  id="contact-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's this about?"
                  className="bg-slate-800/60 border-slate-700"
                  required
                  aria-required="true"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5" htmlFor="contact-message">Message</label>
                <textarea
                  id="contact-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you need help with..."
                  className="w-full min-h-[120px] px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-md text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  required
                  aria-required="true"
                />
              </div>

              <Button
                type="submit"
                disabled={sendContactMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 gap-2"
              >
                {sendContactMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Send Message
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-800">
              <p className="text-sm text-slate-400 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Or email us directly at <a href="mailto:contact@kelionai.app" className="text-blue-400 hover:underline">contact@kelionai.app</a>
              </p>
            </div>
          </Card>
        ) : (
          <Card className="bg-slate-900/80 border-slate-800 p-6 md:p-8">
            <div className="text-center mb-6">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-green-400">Message Sent!</h2>
              <p className="text-slate-400 mt-2">Thank you for reaching out. We'll get back to you soon.</p>
            </div>

            {aiResponse && (
              <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-blue-400">AI Assistant Response</span>
                </div>
                <p className="text-sm text-slate-300">{aiResponse}</p>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <Button onClick={() => { setSubmitted(false); setSubject(""); setMessage(""); setAiResponse(""); }} variant="outline" className="border-slate-700">
                Send Another Message
              </Button>
              <Button onClick={() => setLocation("/")} className="bg-blue-600 hover:bg-blue-700">
                Back to Home
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
