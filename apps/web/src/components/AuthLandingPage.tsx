import { useState, type FormEvent } from "react";
import { Bot, Crown, LockKeyhole, Sparkles, UserPlus } from "lucide-react";
import { createAdmin, login, signup, type AppUser } from "../lib/api";

type AuthMode = "login" | "signup" | "admin";

type AuthLandingPageProps = {
  onAuthenticated: (user: AppUser) => void;
};

export function AuthLandingPage({ onAuthenticated }: AuthLandingPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState({ email: "", display_name: "", password: "", setup_token: "" });
  const [statusMessage, setStatusMessage] = useState("Sign in to open AI Studio.");
  const [isBusy, setIsBusy] = useState(false);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    try {
      const response =
        mode === "admin"
          ? await createAdmin(form)
          : mode === "signup"
            ? await signup(form)
            : await login({ email: form.email, password: form.password });
      localStorage.setItem("vmb-local-user", JSON.stringify(response.user));
      localStorage.setItem("vmb-local-session-token", response.local_session_token);
      setStatusMessage(response.message);
      onAuthenticated(response.user);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsBusy(false);
    }
  }

  const modes = [
    { id: "login" as const, label: "Login", icon: LockKeyhole, detail: "Existing local profile" },
    { id: "signup" as const, label: "Sign Up", icon: UserPlus, detail: "Standard user profile" },
    { id: "admin" as const, label: "Create Admin", icon: Crown, detail: "Full studio access" },
  ];
  const ActiveIcon = modes.find((item) => item.id === mode)?.icon || LockKeyhole;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_16%_10%,rgba(182,255,135,0.55),transparent_26%),radial-gradient(circle_at_80%_12%,rgba(255,143,112,0.22),transparent_24%),linear-gradient(135deg,#f7fbf6_0%,#f5eddf_48%,#fffaf4_100%)] p-4 text-ink">
      <section className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2.4rem] border border-white/70 bg-white/65 p-6 shadow-panel backdrop-blur md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-white">
            <Sparkles className="h-4 w-4" aria-hidden />
            AI Studio
          </div>
          <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[0.96] tracking-[-0.06em] text-ink md:text-6xl">
            Build, run, and govern local AI workflows.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-ink/62">
            Login first so workflows, runs, publishing, files, audit logs, and admin dashboards have proper ownership.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Admin", "All workflows, usage, audit, health, permissions, publish controls."],
              ["User", "Create and run owned/shared workflows with limited system access."],
              ["Local-first", "SQLite, local uploads, Chroma, and OpenRouter provider config."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[1.5rem] bg-white/80 p-4 ring-1 ring-ink/6">
                <p className="text-sm font-black text-ink">{title}</p>
                <p className="mt-2 text-xs leading-5 text-ink/55">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submitAuth} className="rounded-[2.4rem] border border-white/80 bg-white/88 p-5 shadow-panel backdrop-blur md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-ink/42">Studio Access</p>
              <h2 className="mt-2 flex items-center gap-2 text-2xl font-black">
                <ActiveIcon className="h-6 w-6" aria-hidden />
                {modes.find((item) => item.id === mode)?.label}
              </h2>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime/45">
              <Bot className="h-6 w-6" aria-hidden />
            </div>
          </div>

          <div className="mt-5 grid gap-2 rounded-[1.3rem] bg-mist/80 p-1 sm:grid-cols-3">
            {modes.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={`rounded-[1rem] px-3 py-3 text-left transition ${
                    mode === item.id ? "bg-ink text-white shadow-sm" : "text-ink/62 hover:bg-white/70"
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs font-black">
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 opacity-70">{item.detail}</span>
                </button>
              );
            })}
          </div>

          {mode !== "login" ? (
            <input
              value={form.display_name}
              onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
              placeholder="Display name"
              className="mt-4 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
              required
            />
          ) : null}
          <input
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="Email"
            type="email"
            className="mt-3 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
            required
          />
          <input
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="Password"
            type="password"
            className="mt-3 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
            required
            minLength={mode === "login" ? 1 : 6}
          />
          {mode === "admin" ? (
            <input
              value={form.setup_token}
              onChange={(event) => setForm((current) => ({ ...current, setup_token: event.target.value }))}
              placeholder="Admin setup token, required after first admin"
              type="password"
              className="mt-3 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
            />
          ) : null}

          <button
            type="submit"
            disabled={isBusy}
            className="mt-4 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white disabled:opacity-55"
          >
            {isBusy ? "Working..." : mode === "admin" ? "Create Admin Profile" : mode === "signup" ? "Create User Profile" : "Enter Studio"}
          </button>
          <p className="mt-4 rounded-2xl bg-mist/70 px-4 py-3 text-xs leading-5 text-ink/62">
            {statusMessage}
          </p>
        </form>
      </section>
    </main>
  );
}
