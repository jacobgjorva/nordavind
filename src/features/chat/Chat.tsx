import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logo } from "../../ui/Logo";
import { CopyIcon, ShareIcon } from "../../ui/Icons";
import {
  apiConfigured,
  streamChat,
  type ApiMessage,
  type SourceRef,
} from "../../lib/api";
import styles from "./Chat.module.css";

interface ChatMessage extends ApiMessage {
  id: string;
  loading?: boolean;
  error?: boolean;
  reasoning?: string;
  /** Faktisk modell backend valgte (fra streamen) */
  resolvedModel?: string;
  /** Kilder fra backendens websøk */
  sources?: SourceRef[];
}

// Én glød-farge per modell i thinking-animasjonen.
const MODEL_GLOW: Record<string, string> = {
  "mistral-large-3": "#ffffff",
  "glm-5.2": "#c9a8ff",
};

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

// Handlingsrad under hvert assistentsvar: kopier, del, kilder.
function MessageActions({
  content,
  sources = [],
}: {
  content: string;
  sources?: SourceRef[];
}) {
  const [open, setOpen] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(content);
  }

  function share() {
    if (navigator.share) {
      navigator.share({ text: content }).catch(() => {});
    } else {
      copy();
    }
  }

  return (
    <div className={styles.actions}>
      <button className={styles.actionBtn} onClick={copy} title="Kopier" aria-label="Kopier">
        <CopyIcon size={15} />
      </button>
      <button className={styles.actionBtn} onClick={share} title="Del" aria-label="Del">
        <ShareIcon size={15} />
      </button>
      {sources.length > 0 && (
        <>
          <button className={styles.sourcesBtn} onClick={() => setOpen((o) => !o)}>
            <span className={styles.sourcesCount}>{sources.length}</span>
            Kilder
          </button>
          {open && (
            <div className={styles.sourcesList}>
              {sources.map((s) => (
                <SourceLink key={s.url} href={s.url}>
                  {s.title || s.url}
                </SourceLink>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Kildelenker rendres som små tags med favicon + sidenavn i stedet for URL.
function SourceLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  let host = "";
  try {
    host = href ? new URL(href).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }

  const text = Array.isArray(children) ? children.join("") : String(children ?? "");
  let label: React.ReactNode = children;
  if (host && (text === href || text.startsWith("http"))) {
    const name = host.split(".")[0];
    label = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.sourceTag}>
      {label}
      <span className={styles.sourceArrow}>↗</span>
    </a>
  );
}

// Komprimerer resonneringsstrømmen til 1-3 ord: siste **uthevede** frase,
// ellers de første ordene i siste linje.
function thinkingLabel(reasoning?: string): string {
  if (!reasoning?.trim()) return "Tenker";
  const bolds = reasoning.match(/\*\*([^*]{2,60})\*\*/g);
  let raw = bolds ? bolds[bolds.length - 1].replace(/\*/g, "") : "";
  if (!raw) {
    const lines = reasoning.trim().split("\n").filter(Boolean);
    raw = lines[lines.length - 1] ?? "";
  }
  const words = raw
    .replace(/[#*:.\d()]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  return words || "Tenker";
}

export function Chat({ onTitle }: { onTitle?: (title: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Zoom/vindusendring endrer scrollHeight — juster tekstfeltet på nytt.
  useEffect(() => {
    function resize() {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function update(id: string, patch: Partial<ChatMessage>) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    if (messages.length === 0) onTitle?.(text.slice(0, 60));

    const history: ApiMessage[] = [
      ...messages
        .filter((m) => !m.error)
        .map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];

    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: text },
      { id: replyId, role: "assistant", content: "", loading: true },
    ]);

    if (!apiConfigured) {
      update(replyId, {
        loading: false,
        error: true,
        content: "Backend er ikke konfigurert. Sett VITE_API_BASE_URL (og evt. VITE_API_KEY) i .env.local.",
      });
      return;
    }

    setBusy(true);
    abortRef.current = new AbortController();
    try {
      let acc = "";
      let think = "";
      let resolved: string | undefined;
      const sources: SourceRef[] = [];
      await streamChat(
        "auto",
        history,
        (delta) => {
          if (delta.reasoning) think += delta.reasoning;
          if (delta.content) acc += delta.content;
          if (delta.model) {
            resolved = delta.model;
            setActiveModel(delta.model);
          }
          if (delta.sources) {
            for (const s of delta.sources) {
              if (!sources.some((x) => x.url === s.url)) sources.push(s);
            }
          }
          update(replyId, {
            loading: !acc && !think,
            content: acc,
            reasoning: acc ? undefined : think,
            resolvedModel: resolved,
            sources: [...sources],
          });
        },
        abortRef.current.signal
      );
      if (!acc) update(replyId, { loading: false, content: "(tomt svar)" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      update(replyId, {
        loading: false,
        error: true,
        content: `Klarte ikke hente svar (${msg}).`,
      });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const composer = (
    <div className={styles.composer}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={1}
          placeholder="Spør om hva som helst …"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.modelInfo}>
          Using {activeModel ?? "auto"}
        </span>
        <span className={styles.sendHint}>
          Send <span className={styles.kbd}>↵</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.chatRoot}>
      {hasMessages ? (
        <div className={styles.conversation}>
          <div className={styles.messages}>
            <div className={styles.messagesInner}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`${styles.row} ${
                    m.role === "user" ? styles.user : styles.assistant
                  }`}
                >
                  <div
                    className={`${styles.bubble} ${
                      m.error ? styles.error : ""
                    }`}
                  >
                    {m.content ? (
                      m.role === "assistant" && !m.error ? (
                        <div className={styles.markdown}>
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{ a: SourceLink }}
                          >
                            {m.content}
                          </Markdown>
                          {!busy && (
                            <MessageActions
                              content={m.content}
                              sources={m.sources}
                            />
                          )}
                        </div>
                      ) : (
                        m.content
                      )
                    ) : m.role === "assistant" && !m.error ? (
                      <div className={styles.thinkingRow}>
                        <span className={styles.thinkingLogo}>
                          <Logo
                            size={12}
                            flutter
                            glow={MODEL_GLOW[m.resolvedModel ?? ""] ?? "#ffffff"}
                          />
                        </span>
                        <span className={styles.reasoning}>
                          {thinkingLabel(m.reasoning)} …
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className={styles.composerDocked}>
            <div className={styles.composerWrap}>{composer}</div>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.composerWrap}>{composer}</div>
        </div>
      )}
    </div>
  );
}
