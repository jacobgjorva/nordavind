import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logo } from "../../ui/Logo";
import {
  AttachIcon,
  CopyIcon,
  DotsIcon,
  SearchIcon,
  ShareIcon,
} from "../../ui/Icons";
import {
  apiConfigured,
  appendChatMessage,
  createChat,
  extractFile,
  fetchChatMessages,
  generateChatTitle,
  streamChat,
  type ApiMessage,
  type Attachment,
  type ChatSummary,
  type SourceRef,
} from "../../lib/api";
import { CodeBlock, renderFenced } from "./Widgets";
import styles from "./Chat.module.css";

// Fenced kodeblokker: spesial-språk (```stat/```table/```copy/```actions)
// blir widgets, resten blir kodeblokk med kopier-knapp.
function MarkdownPre({ children }: { children?: React.ReactNode }) {
  const code = (children as any)?.props;
  const lang = (code?.className as string | undefined)?.replace("language-", "");
  const body =
    typeof code?.children === "string"
      ? code.children
      : Array.isArray(code?.children)
        ? code.children.join("")
        : "";
  if (lang) {
    const widget = renderFenced(lang, body.replace(/\n$/, ""));
    if (widget) return <>{widget}</>;
  }
  return <CodeBlock lang={lang}>{children}</CodeBlock>;
}

interface ChatMessage extends ApiMessage {
  id: string;
  loading?: boolean;
  error?: boolean;
  reasoning?: string;
  /** Svar under streaming — rendres med fade-in i stedet for markdown */
  streaming?: boolean;
  /** Faktisk modell backend valgte (fra streamen) */
  resolvedModel?: string;
  /** Kilder fra backendens websøk */
  sources?: SourceRef[];
  /** Tidslinje over hva modellen gjør mens den tenker */
  steps?: string[];
  /** Det brukeren faktisk skrev (uten vedleggstekst) */
  display?: string;
  /** Navn på vedlagte filer */
  attachmentNames?: string[];
}

// Nordavind-aliaser: vindskalaen navngir modellnivåene i UI.
const MODEL_ALIAS: Record<string, string> = {
  "mistral-large-3": "Bris",
  "glm-5.2": "Storm",
};

const modelAlias = (model: string | null) =>
  model ? MODEL_ALIAS[model] ?? model : "auto";

// Én glød-farge per modell i thinking-animasjonen.
const MODEL_GLOW: Record<string, string> = {
  "mistral-large-3": "#ffffff",
  "glm-5.2": "#c9a8ff",
};

// Kollisjonsfrie ID-er: en teller nullstilles ved hot reload og gjenbruker
// ID-er, som gjør at update() overskriver gamle meldinger.
const nextId = () => crypto.randomUUID();

// Streamet tekst der hele ord fades inn i jevn takt, frikoblet fra
// nettverks-chunkenes rykkete ankomst. Ufullstendige ord holdes tilbake;
// markdown tar over når svaret er ferdig.
function StreamingText({ content }: { content: string }) {
  const [visible, setVisible] = useState(0);

  // Commit kun frem til siste ordgrense.
  const boundary = Math.max(content.lastIndexOf(" "), content.lastIndexOf("\n"));
  const committed = boundary >= 0 ? content.slice(0, boundary + 1) : "";
  const words = committed.match(/\S+\s*|\s+/g) ?? [];

  useEffect(() => {
    if (visible >= words.length) return;
    // Jevn takt; øker steget hvis vi ligger langt bak streamen.
    const backlog = words.length - visible;
    const t = setTimeout(
      () => setVisible((v) => Math.min(v + Math.ceil(backlog / 25), words.length)),
      45
    );
    return () => clearTimeout(t);
  }, [visible, words.length]);

  return (
    <span className={styles.streamingText}>
      {words.slice(0, visible).map((w, i) => (
        <span key={i} className={styles.fadeSeg}>
          {w}
        </span>
      ))}
    </span>
  );
}

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

  // Numeriske referanselenker ([1] med definisjon nederst) rendres som
  // hevet kildehenvisning i Perplexity-stil.
  if (/^\d{1,2}$/.test(text.trim())) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={styles.citation}>
        {text.trim()}
      </a>
    );
  }

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

export function Chat({
  chatId,
  initialTitle,
  onChatCreated,
  onTitleGenerated,
}: {
  chatId: string | null;
  initialTitle?: string | null;
  onChatCreated?: (chat: ChatSummary) => void;
  onTitleGenerated?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState<string | null>(initialTitle ?? null);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);

  useEffect(() => {
    if (!titleMenuOpen) return;
    const close = () => setTitleMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [titleMenuOpen]);
  const chatIdRef = useRef<string | null>(chatId);

  // Last inn lagrede meldinger når en eksisterende samtale åpnes.
  useEffect(() => {
    if (!chatId) return;
    fetchChatMessages(chatId)
      .then((stored) =>
        setMessages(
          stored.map((m) => ({
            id: nextId(),
            role: m.role,
            content: m.content,
            sources: m.sources ? JSON.parse(m.sources) : undefined,
          }))
        )
      )
      .catch(() => {});
  }, [chatId]);
  const [input, setInput] = useState("");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasMessages = messages.length > 0;

  // Nytt spørsmål ankres i toppen av viewporten (ChatGPT-stil); svaret
  // strømmer nedover derfra og brukeren eier scrollen ellers.
  const ANCHOR = 96;

  // Én gang per ny melding: reserver plass i siste svar-rad slik at siste
  // spørsmål står ved ankeret når vi ligger helt nede. Ingen måling per
  // chunk — teksten strømmer inn i allerede reservert plass.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>("[data-role]");
    rows.forEach((r) => (r.style.minHeight = ""));
    const users = el.querySelectorAll<HTMLElement>('[data-role="user"]');
    const lastUser = users[users.length - 1];
    const last = rows[rows.length - 1];
    if (lastUser && last && last.dataset.role === "assistant") {
      const offset =
        last.getBoundingClientRect().top -
        lastUser.getBoundingClientRect().top;
      const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const needed = el.clientHeight - ANCHOR - padBottom - offset;
      last.style.minHeight = `${Math.max(0, needed)}px`;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Per chunk: bare hold oss helt nede (no-op til svaret overstiger
  // reservert plass).
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploadError(null);
    for (const file of [...files].slice(0, 3 - attachments.length)) {
      try {
        const att = await extractFile(file);
        setAttachments((prev) => [...prev, att]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ukjent feil";
        setUploadError(`${file.name}: ${msg}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    setInput("");
    setUploadError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Opprett samtalen i backend ved første melding.
    if (!chatIdRef.current) {
      try {
        const chat = await createChat(text.slice(0, 60) || "Ny samtale");
        chatIdRef.current = chat.id;
        onChatCreated?.(chat);
      } catch {
        // Persistens er ikke kritisk for å svare
      }
    }

    // Vedleggstekst sendes til modellen, men vises ikke i bobla.
    const files = attachments;
    setAttachments([]);
    const fileBlocks = files
      .map((a) => `[Vedlegg: ${a.name}]\n${a.text}`)
      .join("\n\n");
    const apiContent = fileBlocks ? `${fileBlocks}\n\n${text}` : text;

    const history: ApiMessage[] = [
      ...messages
        .filter((m) => !m.error)
        .map(({ role, content }) => ({ role, content })),
      { role: "user", content: apiContent },
    ];

    const userMsgId = nextId();
    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: apiContent,
        display: text,
        attachmentNames: files.map((a) => a.name),
      },
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
      const steps: string[] = [];
      const pushStep = (label: string) => {
        if (label && steps[steps.length - 1] !== label && steps.length < 10) {
          steps.push(label);
        }
      };
      await streamChat(
        "auto",
        history,
        (delta) => {
          if (delta.reasoning) think += delta.reasoning;
          if (delta.step) pushStep(delta.step);
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
            loading: !acc && !think && steps.length === 0,
            content: acc,
            reasoning: acc ? undefined : think,
            streaming: true,
            resolvedModel: resolved,
            sources: [...sources],
            steps: [...steps],
          });
        },
        abortRef.current.signal
      );
      update(replyId, { streaming: false });
      if (!acc) update(replyId, { loading: false, content: "(tomt svar)" });

      // Persister utvekslingen (vedleggstekst lagres ikke, kun navn).
      if (chatIdRef.current && acc) {
        const displayContent =
          files.length > 0
            ? `${text}\n\n[Vedlegg: ${files.map((a) => a.name).join(", ")}]`
            : text;
        const cid = chatIdRef.current;
        const isFirstExchange = history.length === 1;
        appendChatMessage(cid, { role: "user", content: displayContent })
          .then(() =>
            appendChatMessage(cid, {
              role: "assistant",
              content: acc,
              sources: sources.length ? JSON.stringify(sources) : undefined,
            })
          )
          .catch(() => {});
        if (isFirstExchange) {
          generateChatTitle(cid, text, acc)
            .then((t) => {
              setTitle(t);
              onTitleGenerated?.();
            })
            .catch(() => {});
        }
      }
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
      {(attachments.length > 0 || uploadError) && (
        <div className={styles.attachRow}>
          {attachments.map((a) => (
            <span key={a.name} className={styles.attachChip}>
              {a.name}
              <button
                className={styles.attachRemove}
                onClick={() =>
                  setAttachments((prev) => prev.filter((x) => x !== a))
                }
                aria-label={`Fjern ${a.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {uploadError && (
            <span className={styles.attachError}>{uploadError}</span>
          )}
        </div>
      )}
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
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.md,.csv,.json,.log,text/*"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          className={styles.actionBtn}
          onClick={() => fileInputRef.current?.click()}
          title="Legg ved fil"
          aria-label="Legg ved fil"
        >
          <AttachIcon size={15} />
        </button>
        <span className={styles.modelInfo}>
          Modell: {modelAlias(activeModel)}
        </span>
        <span className={styles.sendHint}>
          Send <span className={styles.kbd}>↵</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.chatRoot}>
      {title && hasMessages && (
        <div className={styles.titlePill}>
          <span className={styles.titleText}>{title}</span>
          <button
            className={styles.titleMenuBtn}
            onClick={(e) => {
              e.stopPropagation();
              setTitleMenuOpen((o) => !o);
            }}
            aria-label="Samtalemeny"
          >
            <DotsIcon size={15} />
          </button>
          {titleMenuOpen && (
            <div className={styles.titleMenu}>
              <span className={styles.titleMenuEmpty}>Kommer snart</span>
            </div>
          )}
        </div>
      )}
      {hasMessages ? (
        <div className={styles.conversation}>
          <div className={styles.messages} ref={messagesRef}>
            <div className={styles.messagesInner}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  data-mid={m.id}
                  data-role={m.role}
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
                      m.role === "assistant" && m.streaming ? (
                        <StreamingText content={m.content} />
                      ) : m.role === "assistant" && !m.error ? (
                        <div className={styles.markdown}>
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{ a: SourceLink, pre: MarkdownPre }}
                          >
                            {m.content}
                          </Markdown>
                          {!m.streaming && !m.loading && (
                            <MessageActions
                              content={m.content}
                              sources={m.sources}
                            />
                          )}
                        </div>
                      ) : (
                        <>
                          {m.display ?? m.content}
                          {m.attachmentNames &&
                            m.attachmentNames.length > 0 && (
                              <span className={styles.attachRow}>
                                {m.attachmentNames.map((name) => (
                                  <span
                                    key={name}
                                    className={styles.attachChip}
                                  >
                                    {name}
                                  </span>
                                ))}
                              </span>
                            )}
                        </>
                      )
                    ) : m.role === "assistant" && !m.error ? (
                      <div className={styles.timeline}>
                        <div className={styles.step}>
                          <span className={styles.thinkingLogo}>
                            <Logo
                              size={10}
                              flutter
                              glow={
                                MODEL_GLOW[m.resolvedModel ?? ""] ?? "#ffffff"
                              }
                            />
                          </span>
                          <span className={styles.stepActive}>
                            {thinkingLabel(m.reasoning)} …
                          </span>
                        </div>
                        {(m.steps ?? []).map((step, i) => (
                          <div key={i}>
                            <span className={styles.stepLine} />
                            <div className={styles.step}>
                              <span className={styles.stepIcon}>
                                <SearchIcon size={14} />
                              </span>
                              <span className={styles.reasoning}>{step}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
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
