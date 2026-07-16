import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logo } from "../../ui/Logo";
import { apiConfigured, MODELS, streamChat, type ApiMessage } from "../../lib/api";
import styles from "./Chat.module.css";

interface ChatMessage extends ApiMessage {
  id: string;
  loading?: boolean;
  error?: boolean;
  reasoning?: string;
  /** Satt når auto-ruting eskalerte til en tyngre modell */
  ultraModel?: string;
}

const ULTRA_MODELS = new Set(["glm-5.2", "kimi-k2.6"]);

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

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
  const [model, setModel] = useState(MODELS[0] ?? "");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const close = () => setModelMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [modelMenuOpen]);

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
      let ultra: string | undefined;
      await streamChat(
        model,
        history,
        (delta) => {
          if (delta.reasoning) think += delta.reasoning;
          if (delta.content) acc += delta.content;
          if (model === "auto" && delta.model && ULTRA_MODELS.has(delta.model)) {
            ultra = delta.model;
          }
          update(replyId, {
            loading: !acc && !think,
            content: acc,
            reasoning: acc ? undefined : think,
            ultraModel: ultra,
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
        <div className={styles.modelWrap}>
          <button
            className={styles.modelButton}
            onClick={(e) => {
              e.stopPropagation();
              setModelMenuOpen((o) => !o);
            }}
          >
            {model || "ingen modell"} ▾
          </button>
          {modelMenuOpen && (
            <div className={styles.modelMenu}>
              {MODELS.map((m) => (
                <button
                  key={m}
                  className={`${styles.modelOption} ${
                    m === model ? styles.modelOptionActive : ""
                  }`}
                  onClick={() => {
                    setModel(m);
                    setModelMenuOpen(false);
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
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
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </Markdown>
                        </div>
                      ) : (
                        m.content
                      )
                    ) : m.role === "assistant" && !m.error ? (
                      <div className={styles.thinkingRow}>
                        <span className={styles.thinkingLogo}>
                          <Logo size={12} flutter ultra={!!m.ultraModel} />
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
          <div className={styles.greeting}>Hva kan jeg hjelpe med?</div>
          <div className={styles.composerWrap}>{composer}</div>
        </div>
      )}
    </div>
  );
}
