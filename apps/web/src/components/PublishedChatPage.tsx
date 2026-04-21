import { useEffect, useState } from "react";
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(182,255,135,0.36),_transparent_26%),linear-gradient(135deg,_#081018_0%,_#16302f_52%,_#f4eee2_140%)] px-4 py-8 text-white lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-panel backdrop-blur">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
          >
            Back to Workflows
          </button>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-white/55">
            Published Chatbot
          </p>
          <h1 className="mt-2 text-4xl font-bold">{slug}</h1>
          <p className="mt-3 text-sm leading-6 text-white/68">{statusMessage}</p>

          {chatbot ? (
            <div className="mt-5 rounded-[1.5rem] bg-white/10 p-4 text-sm text-white/72">
              Workflow #{chatbot.workflow_id}
              <br />
              Endpoint: {chatbot.chat_endpoint}
            </div>
          ) : null}

          <label className="mt-5 block">
            <span className="text-sm font-semibold">Session ID</span>
            <input
              type="text"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-semibold">User ID</span>
            <input
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
        </aside>

        <section className="flex min-h-[78vh] flex-col rounded-[2rem] border border-white/10 bg-white/90 p-5 text-ink shadow-panel">
          <div className="flex-1 space-y-4 overflow-auto rounded-[1.5rem] bg-mist/70 p-4">
            {messages.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-ink/15 bg-white p-6 text-sm leading-6 text-ink/62">
                Send a message to execute this published workflow. Conversation memory uses the
                session and user values on the left.
              </div>
            ) : (
              messages.map((item, index) => (
                <article
                  key={`${item.role}-${index}`}
                  className={`max-w-[82%] rounded-[1.5rem] px-4 py-3 text-sm leading-6 ${
                    item.role === "user"
                      ? "ml-auto bg-ink text-white"
                      : "mr-auto bg-white text-ink shadow-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.content}</p>
                  {item.citations?.length ? (
                    <div className="mt-3 rounded-2xl bg-lime/25 px-3 py-2 text-xs text-ink">
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
          </div>

          <div className="mt-4 flex gap-3">
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
              className="min-w-0 flex-1 rounded-full border border-ink/10 bg-white px-5 py-3 text-sm outline-none focus:border-ink/25"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={isSending}
              className="rounded-full bg-lime px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
