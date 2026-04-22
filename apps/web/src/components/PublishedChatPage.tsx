import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Copy, MessageCircle, RotateCcw, Send, Sparkles, UserRound } from "lucide-react";
import {
  getPublishedChatbot,
  sendPublishedChatMessage,
  type PublishedChatResponse,
  type PublishWorkflowResponse,
} from "../lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Array<Record<string, unknown>>;
};

type PublishedChatPageProps = {
  slug: string;
  onBack: () => void;
};

export function PublishedChatPage({ slug, onBack }: PublishedChatPageProps) {
  const [chatbot, setChatbot] = useState<PublishWorkflowResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("Hello, can you help me?");
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`);
  const [userId, setUserId] = useState("local-user");
  const [statusMessage, setStatusMessage] = useState("Loading published chatbot.");
  const [isSending, setIsSending] = useState(false);
  const suggestedPrompts = [
    "Summarize what you can help with.",
    "Give me a concise answer with sources if available.",
    "Turn this into a practical checklist.",
  ];

  useEffect(() => {
    getPublishedChatbot(slug)
      .then((record) => {
        setChatbot(record);
        setStatusMessage("Published workflow is ready.");
      })
      .catch((error) => {
        const nextMessage = error instanceof Error ? error.message : "Could not load chatbot.";
        setStatusMessage(nextMessage);
      });
  }, [slug]);

  async function sendMessage() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    setIsSending(true);
    setMessages((current) => current.concat({ role: "user", content: trimmedMessage }));
    setMessage("");

    try {
      const response: PublishedChatResponse = await sendPublishedChatMessage(slug, {
        message: trimmedMessage,
        session_id: sessionId,
        user_id: userId,
        metadata: { source: "published-chat-ui" },
      });
      setMessages((current) =>
        current.concat({
          role: "assistant",
          content: response.answer || "The workflow completed without a chat answer.",
          citations: response.citations,
        }),
      );
      setStatusMessage(`Run #${response.run_id} completed.`);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Message failed.";
      setMessages((current) =>
        current.concat({ role: "assistant", content: `Error: ${nextMessage}` }),
      );
      setStatusMessage(nextMessage);
    } finally {
      setIsSending(false);
    }
  }

  async function copyEndpoint() {
    if (!chatbot) return;
    try {
      await navigator.clipboard.writeText(chatbot.chat_endpoint);
      setStatusMessage("Chat endpoint copied.");
    } catch {
      setStatusMessage(chatbot.chat_endpoint);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_8%,_rgba(182,255,135,0.28),_transparent_24%),radial-gradient(circle_at_86%_18%,_rgba(126,211,255,0.18),_transparent_24%),linear-gradient(135deg,_#07100f_0%,_#142d2a_52%,_#f4eee2_150%)] px-4 py-6 text-white lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="relative overflow-hidden rounded-[2.25rem] border border-white/12 bg-white/10 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
          <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-lime/20 blur-3xl" />
          <div className="absolute -bottom-20 left-6 h-40 w-40 rounded-full bg-coral/14 blur-3xl" />
          <div className="relative">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Workflows
          </button>
          <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.24em] text-white/58">
            <Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />
            Published Chatbot
          </div>
          <h1 className="mt-3 flex items-center gap-3 text-4xl font-black tracking-tight">
            <span className="grid h-12 w-12 place-items-center rounded-[1.35rem] bg-lime text-ink shadow-[0_18px_40px_rgba(182,255,135,0.22)]">
              <Bot className="h-6 w-6" aria-hidden />
            </span>
            <span className="break-all">{slug}</span>
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/68">{statusMessage}</p>

          {chatbot ? (
            <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/10 p-4 text-sm text-white/72">
              <p className="font-bold text-white">Workflow #{chatbot.workflow_id}</p>
              <p className="mt-2 break-all text-xs leading-5 text-white/55">{chatbot.chat_endpoint}</p>
              <button type="button" onClick={copyEndpoint} className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/18">
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy endpoint
              </button>
            </div>
          ) : null}

          <label className="mt-5 block">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="h-4 w-4" aria-hidden />
              Session ID
            </span>
            <input
              type="text"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          <label className="mt-4 block">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <UserRound className="h-4 w-4" aria-hidden />
              User ID
            </span>
            <input
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          <div className="mt-5 rounded-[1.5rem] bg-black/10 p-4">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/42">Starter prompts</p>
            <div className="mt-3 grid gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setMessage(prompt)}
                  className="rounded-2xl bg-white/10 px-3 py-2 text-left text-xs font-semibold leading-5 text-white/70 transition hover:bg-lime/20 hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setSessionId(`session-${Date.now()}`);
              setStatusMessage("Started a fresh local chat session.");
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/16"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            New session
          </button>
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[2.25rem] border border-white/70 bg-white/88 p-4 text-ink shadow-[0_30px_90px_rgba(7,16,15,0.20)] backdrop-blur-2xl">
          <div className="mb-4 rounded-[1.75rem] bg-ink px-5 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/42">Conversation</p>
            <h2 className="mt-1 text-2xl font-black">Ask, iterate, and keep context by session</h2>
          </div>
          <div className="flex-1 space-y-4 overflow-auto rounded-[1.75rem] bg-[linear-gradient(180deg,_rgba(231,238,231,0.78),_rgba(255,255,255,0.78))] p-4">
            {messages.length === 0 ? (
              <div className="grid min-h-80 place-items-center rounded-[1.5rem] border border-dashed border-ink/15 bg-white/78 p-6 text-center text-sm leading-6 text-ink/62">
                <div>
                  <Bot className="mx-auto h-10 w-10 text-ink/30" aria-hidden />
                  <p className="mt-3 font-semibold text-ink">Ready for your first message</p>
                  <p className="mt-1 max-w-md">This chat endpoint sends a message, session id, and user id into the published workflow.</p>
                </div>
              </div>
            ) : (
              messages.map((item, index) => (
                <article
                  key={`${item.role}-${index}`}
                  className={`max-w-[86%] rounded-[1.55rem] px-4 py-3 text-sm leading-6 ${
                    item.role === "user"
                      ? "ml-auto bg-ink text-white shadow-[0_16px_36px_rgba(7,16,15,0.16)]"
                      : "mr-auto bg-white text-ink shadow-sm ring-1 ring-ink/6"
                  }`}
                >
                  <p className={`mb-1 text-[10px] font-black uppercase tracking-[0.22em] ${item.role === "user" ? "text-white/42" : "text-ink/38"}`}>
                    {item.role === "user" ? "You" : "AI Studio"}
                  </p>
                  <p className="whitespace-pre-wrap">{item.content}</p>
                  {item.citations?.length ? (
                    <div className="mt-3 rounded-2xl bg-lime/25 px-3 py-2 text-xs text-ink ring-1 ring-lime/20">
                      <p className="font-semibold">{item.citations.length} source(s)</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.citations.slice(0, 4).map((citation, citationIndex) => (
                          <span
                            key={`${String(citation.chunk_id || citationIndex)}-${String(citation.source_path || citation.title || "")}`}
                            className="rounded-full bg-white/80 px-3 py-1 text-ink/75"
                          >
                            {String(citation.title || citation.source_path || `Source ${citationIndex + 1}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
            {isSending ? (
              <div className="mr-auto max-w-[72%] rounded-[1.5rem] bg-white px-4 py-3 text-sm font-semibold text-ink/60 shadow-sm ring-1 ring-ink/6">
                AI Studio is thinking...
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex gap-3 rounded-full border border-ink/8 bg-white p-2 shadow-sm">
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMessage();
                }
              }}
              placeholder="Type a message..."
              className="min-w-0 flex-1 rounded-full bg-transparent px-4 py-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={isSending}
              className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden />
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
