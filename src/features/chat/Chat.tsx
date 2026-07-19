import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logo } from "../../ui/Logo";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AnonymousIcon,
  Copy01Icon,
  DashboardSquare01Icon,
  Delete01Icon,
  FastWindIcon,
} from "@hugeicons/core-free-icons";
import { AttachIcon, SearchIcon } from "../../ui/Icons";
import {
  apiConfigured,
  appendChatMessage,
  createChat,
  extractFile,
  fetchChatMessages,
  createWidget,
  listWidgets,
  type Widget,
  fetchInbox,
  type MailThreadSummary,
  deleteAgent,
  extractKnowledge,
  fetchChatAgent,
  generateChatTitle,
  logCorrection,
  readImage,
  renameChat,
  setAgentEnabled,
  type AgentInfo,
  streamChat,
  type ApiMessage,
  type Attachment,
  type ContentPart,
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

interface ChatMessage extends Omit<ApiMessage, "content"> {
  // content er alltid ren tekst for visning; multimodal payload (bilder)
  // ligger i apiContent og sendes til modellen.
  content: string;
  apiContent?: ApiMessage["content"];
  id: string;
  loading?: boolean;
  error?: boolean;
  reasoning?: string;
  /** Svar under streaming — rendres med fade-in i stedet for markdown */
  streaming?: boolean;
  /** Satt når fade-inn-animasjonen har spilt helt ut → bytt til markdown */
  revealed?: boolean;
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
  /** data:-URL-er for vedlagte bilder (forhåndsvisning i bobla) */
  images?: string[];
}

// Nordavind-aliaser: vindskalaen navngir modellnivåene i UI.
const MODEL_ALIAS: Record<string, string> = {
  "qwen3-235b-a22b-instruct-2507": "Bris",
  "qwen3.5-397b-a17b": "Storm",
  "glm-5.2": "Orkan",
  "qwen3.6-35b-a3b": "Kuling",
};

const modelAlias = (model: string | null) =>
  model ? MODEL_ALIAS[model] ?? model : "Bris";

// Kort beskrivelse av hva hver modell er god på.
const MODEL_DESC: Record<string, string> = {
  "qwen3-235b-a22b-instruct-2507": "fikser det meste",
  "qwen3.5-397b-a17b": "god på avanserte oppgaver",
  "glm-5.2": "for de tyngste oppgavene",
  "qwen3.6-35b-a3b": "god på bilder",
};

const modelDesc = (model: string | null) =>
  model ? MODEL_DESC[model] ?? "" : "";

const formatTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// Slash-kommandoer i composeren. Flere kommer; Agent er den eneste nå.
const SLASH_ACTIONS: {
  cmd: string;
  label: string;
  desc: string;
  icon: typeof AnonymousIcon;
}[] = [
  {
    cmd: "agent",
    label: "Agent",
    desc: "Sett opp en automatisert agent",
    icon: AnonymousIcon,
  },
  {
    cmd: "widget",
    label: "Ny widget",
    desc: "Bygg en widget med AI",
    icon: DashboardSquare01Icon,
  },
  {
    cmd: "mail",
    label: "Mail",
    desc: "Les og svar på e-post med AI",
    icon: AnonymousIcon,
  },
];

// Én glød-farge per modell i thinking-animasjonen.
const MODEL_GLOW: Record<string, string> = {
  "qwen3-235b-a22b-instruct-2507": "#ffffff",
  "qwen3.5-397b-a17b": "#c9a8ff",
  "glm-5.2": "#ff9de0",
  "qwen3.6-35b-a3b": "#8fd0ff",
};

// Kollisjonsfrie ID-er: en teller nullstilles ved hot reload og gjenbruker
// ID-er, som gjør at update() overskriver gamle meldinger.
const nextId = () => crypto.randomUUID();

// En melding som kun er en widget- eller mailthread-blokk vises i full bredde.
const isWidgetOnly = (content?: string) =>
  !!content && /^```(widget|mailthread)\n[\s\S]*?\n```$/.test(content.trim());

// Speiler backendens slugify: brukes når /widget-navnet allerede finnes.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Streamet tekst der hele ord fades inn i jevn takt, frikoblet fra
// nettverks-chunkenes rykkete ankomst. Ufullstendige ord holdes tilbake;
// markdown tar over når svaret er ferdig.
function StreamingText({
  content,
  done,
  onDone,
}: {
  content: string;
  done: boolean;
  onDone?: () => void;
}) {
  const [visible, setVisible] = useState(0);

  // Under streaming committes kun frem til siste ordgrense; når svaret er
  // ferdig committes alt, så animasjonen alltid spiller helt ut.
  const boundary = Math.max(content.lastIndexOf(" "), content.lastIndexOf("\n"));
  const committed = done
    ? content
    : boundary >= 0
      ? content.slice(0, boundary + 1)
      : "";
  const words = committed.match(/\S+\s*|\s+/g) ?? [];

  useEffect(() => {
    if (visible >= words.length) {
      if (done) onDone?.();
      return;
    }
    // Jevn takt; øker steget hvis vi ligger langt bak streamen, men alltid
    // minst ett ord av gangen så raske svar også animerer synlig.
    const backlog = words.length - visible;
    const t = setTimeout(
      () =>
        setVisible((v) =>
          Math.min(v + Math.max(1, Math.ceil(backlog / 25)), words.length)
        ),
      38
    );
    return () => clearTimeout(t);
  }, [visible, words.length, done]);

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

// Handlingsrad under hvert assistentsvar: kopier, korriger, kilder.
function MessageActions({
  content,
  sources = [],
  armed = false,
  onArm,
}: {
  content: string;
  sources?: SourceRef[];
  armed?: boolean;
  onArm?: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(content);
  }

  return (
    <div className={styles.actions}>
      <button className={styles.actionBtn} onClick={copy} title="Kopier" aria-label="Kopier">
        <HugeiconsIcon icon={Copy01Icon} size={15} strokeWidth={2} />
      </button>
      <button
        className={`${styles.actionBtn} ${armed ? styles.actionBtnActive : ""}`}
        onClick={() => onArm?.(content)}
        title={armed ? "Neste melding logges som korrigering" : "Korriger dette svaret"}
        aria-label="Korriger svar"
        aria-pressed={armed}
      >
        <HugeiconsIcon icon={FastWindIcon} size={15} strokeWidth={2} />
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
  // Topbar fader inn når man scroller forbi første melding.
  const [scrolledPast, setScrolledPast] = useState(false);
  // Agent bak denne chatten (for pause-knappen), null for vanlige chatter.
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  // Inline-redigering av tittel (dobbeltklikk).
  const [editingTitle, setEditingTitle] = useState(false);
  const chatIdRef = useRef<string | null>(chatId);
  // Brukerens widgets — fyller slash-menyen (/<slug>) og kalles inline.
  const [widgets, setWidgets] = useState<Widget[]>([]);
  // Satt til en slug mens en widget bygges/redigeres i denne samtalen.
  const widgetEditRef = useRef<string | null>(null);
  // True etter et bart /widget: neste melding blir widget-beskrivelsen.
  const widgetPendingRef = useRef(false);

  function reloadWidgets() {
    listWidgets().then(setWidgets).catch(() => {});
  }
  useEffect(() => {
    reloadWidgets();
  }, []);

  // Innboks-tråder til /mail-komboboksen (deklareres etter input-state under).
  const [mailThreads, setMailThreads] = useState<MailThreadSummary[]>([]);
  const mailLoadedRef = useRef(false);

  function saveTitle(next: string) {
    setEditingTitle(false);
    const trimmed = next.trim().slice(0, 60);
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    const cid = chatIdRef.current;
    if (cid) renameChat(cid, trimmed).catch(() => {});
  }

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
            revealed: true,
          }))
        )
      )
      .catch(() => {});
  }, [chatId]);

  // Slå opp om chatten tilhører en agent (viser pause-knapp i topbaren).
  useEffect(() => {
    if (!chatId) {
      setAgent(null);
      return;
    }
    fetchChatAgent(chatId).then(setAgent).catch(() => setAgent(null));
  }, [chatId]);

  async function toggleAgentPause() {
    if (!agent) return;
    const next = !agent.enabled;
    setAgent({ ...agent, enabled: next });
    try {
      await setAgentEnabled(agent.id, next);
      window.dispatchEvent(new CustomEvent("nordavind:agents-changed"));
    } catch {
      setAgent({ ...agent, enabled: !next });
    }
  }

  async function deleteThisAgent() {
    if (!agent) return;
    if (!confirm(`Slette agenten «${agent.name}» og chatten?`)) return;
    try {
      await deleteAgent(agent.id);
      window.dispatchEvent(new CustomEvent("nordavind:agents-changed"));
      window.dispatchEvent(
        new CustomEvent("nordavind:chat-deleted", { detail: chatId })
      );
    } catch {
      // ignorer; brukeren kan prøve igjen
    }
  }

  const [input, setInput] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  // Last innboks når brukeren begynner på /mail.
  useEffect(() => {
    if (/^\/mail\b/i.test(input) && !mailLoadedRef.current) {
      mailLoadedRef.current = true;
      fetchInbox().then(setMailThreads).catch(() => {});
    }
  }, [input]);
  // Bris er standard til backend melder hvilken modell som faktisk svarte.
  const [activeModel, setActiveModel] = useState<string | null>(
    "qwen3-235b-a22b-instruct-2507"
  );
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Armert svar: neste brukermelding logges som korrigering på dette svaret.
  const [correctionTarget, setCorrectionTarget] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // /agent slår på agent-oppsettmodus for resten av denne samtalen, så
  // modellen beholder verktøyene gjennom hele den flerstegs-samtalen.
  const agentModeRef = useRef(false);
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

  // Fade topbar inn så snart første melding scrolles under toppen.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => setScrolledPast(el.scrollTop > 40);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMessages]);

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
        const att = file.type.startsWith("image/")
          ? await readImage(file)
          : await extractFile(file);
        setAttachments((prev) => [...prev, att]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ukjent feil";
        setUploadError(`${file.name}: ${msg}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Kaller en widget inline i chatten: ingen LLM, bare en ```widget <slug>```-
  // blokk som renderer visualiseringen der og da.
  async function renderWidgetInline(raw: string, slug: string) {
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const block = "```widget\n" + slug + "\n```";
    if (!chatIdRef.current) {
      try {
        const chat = await createChat(`/${slug}`);
        chatIdRef.current = chat.id;
        onChatCreated?.(chat);
      } catch {
        // persistens er ikke kritisk
      }
    }
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: raw, display: raw, revealed: true },
      { id: nextId(), role: "assistant", content: block, revealed: true },
    ]);
    const cid = chatIdRef.current;
    if (cid) {
      appendChatMessage(cid, { role: "user", content: raw })
        .then(() =>
          appendChatMessage(cid, { role: "assistant", content: block })
        )
        .catch(() => {});
    }
  }

  // Åpner en e-posttråd inline i chatten (ingen LLM her — MailThread henter
  // selv sammendrag/svarforslag).
  async function renderMailInline(key: string) {
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const t = mailThreads.find((x) => x.key === key);
    const block = "```mailthread\n" + key + "\n```";
    if (!chatIdRef.current) {
      try {
        const chat = await createChat(t?.subject?.slice(0, 60) || "E-post");
        chatIdRef.current = chat.id;
        onChatCreated?.(chat);
      } catch {
        // persistens ikke kritisk
      }
    }
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "user",
        content: `📧 ${t?.subject ?? "E-post"}`,
        display: `📧 ${t?.subject ?? "E-post"}`,
        revealed: true,
      },
      { id: nextId(), role: "assistant", content: block, revealed: true },
    ]);
    const cid = chatIdRef.current;
    if (cid) {
      appendChatMessage(cid, { role: "user", content: `📧 ${t?.subject ?? "E-post"}` })
        .then(() => appendChatMessage(cid, { role: "assistant", content: block }))
        .catch(() => {});
    }
  }

  async function send(overrideText?: string) {
    const raw = (overrideText ?? input).trim();
    if ((!raw && attachments.length === 0) || busy) return;

    // /<slug>: en kjent widget kalt inline — render den, ingen LLM-tur.
    const firstTok = /^\/([a-z0-9-]+)/i.exec(raw)?.[1]?.toLowerCase();
    if (firstTok && firstTok !== "widget" && firstTok !== "agent") {
      const w = widgets.find((x) => x.slug === firstTok);
      if (w) {
        await renderWidgetInline(raw, w.slug);
        return;
      }
    }

    // /agent starter (eller fortsetter) agent-oppsett. Kommandoen fjernes
    // fra selve meldingen; en tom kommando får en frø-melding.
    const isAgentCmd = /^\/agent\b/i.test(raw);
    if (isAgentCmd) agentModeRef.current = true;

    // /widget [beskrivelse]: gå i widget-editor. Uten beskrivelse venter vi
    // på neste melding. Editoren holdes åpen resten av samtalen (som /agent),
    // og widgeten opprettes fra beskrivelsen (navn/slug fra den).
    const isWidgetCmd = /^\/widget\b/i.test(raw);
    let widgetDesc = "";
    if (isWidgetCmd) {
      widgetDesc = raw.replace(/^\/widget\s*/i, "").trim();
      if (!widgetDesc) {
        widgetPendingRef.current = true;
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: "Beskriv widgeten du vil bygge.",
            revealed: true,
          },
        ]);
        return;
      }
    } else if (widgetPendingRef.current) {
      // Ventet på beskrivelse etter et bart /widget.
      widgetDesc = raw;
    }

    // Opprett widgeten første gang vi har en beskrivelse i denne samtalen.
    const buildingWidget = (isWidgetCmd || widgetPendingRef.current) && !!widgetDesc;
    if (buildingWidget && !widgetEditRef.current) {
      try {
        const wg = await createWidget(widgetDesc.slice(0, 60));
        widgetEditRef.current = wg.slug;
      } catch {
        widgetEditRef.current = slugify(widgetDesc.slice(0, 60));
      }
      widgetPendingRef.current = false;
      reloadWidgets();
    }

    const stripped = isAgentCmd ? raw.replace(/^\/agent\s*/i, "").trim() : raw;
    const text = isAgentCmd
      ? stripped || "Jeg vil sette opp en agent."
      : buildingWidget
        ? widgetDesc
        : stripped;

    // Armert korrigering: logg denne meldingen som feedback på svaret.
    const correcting = text ? correctionTarget : null;
    setCorrectionTarget(null);

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

    if (correcting) {
      logCorrection({
        answer: correcting.content,
        correction: text,
        chat_id: chatIdRef.current ?? undefined,
      }).catch(() => {
        // Logging er ikke kritisk for å fortsette samtalen
      });
    }

    // Vedleggstekst sendes til modellen, men vises ikke i bobla.
    const files = attachments;
    setAttachments([]);
    const images = files.filter((a) => a.image);
    const fileBlocks = files
      .filter((a) => !a.image)
      .map((a) => `[Vedlegg: ${a.name}]\n${a.text}`)
      .join("\n\n");
    const textContent = fileBlocks ? `${fileBlocks}\n\n${text}` : text;

    // Med bilder sendes innholdet som deler (tekst + bilde) til vision-modellen.
    const apiContent: string | ContentPart[] = images.length
      ? [
          { type: "text", text: textContent },
          ...images.map(
            (a): ContentPart => ({
              type: "image_url",
              image_url: { url: a.image! },
            })
          ),
        ]
      : textContent;

    const history: ApiMessage[] = [
      ...messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.apiContent ?? m.content })),
      { role: "user", content: apiContent },
    ];

    // Widget-tur: svaret ER widgeten. Sett blokka med én gang så vind-
    // animasjonen starter umiddelbart — ingen loading-prikker, ingen «Ok».
    const widgetTurnSlug = widgetEditRef.current;
    const widgetBlock = widgetTurnSlug
      ? "```widget\n" + widgetTurnSlug + "\n```"
      : "";

    const userMsgId = nextId();
    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: textContent,
        apiContent,
        display: text,
        attachmentNames: files.filter((a) => !a.image).map((a) => a.name),
        images: images.map((a) => a.image!),
      },
      widgetTurnSlug
        ? { id: replyId, role: "assistant", content: widgetBlock, revealed: true }
        : { id: replyId, role: "assistant", content: "", loading: true },
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
          // Widget-tur: ikke rør svaret — blokka + animasjonen står til data er klar.
          if (widgetTurnSlug) return;
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
        abortRef.current.signal,
        {
          agentSetup: agentModeRef.current,
          agentEdit: agent?.id,
          widget: widgetEditRef.current ?? undefined,
        }
      );
      // Widget-tur: blokka står allerede, WidgetView poller til data er klar.
      // Bare oppdater slash-registeret så /<slug> blir tilgjengelig.
      if (widgetTurnSlug) {
        acc = widgetBlock;
        reloadWidgets();
      } else {
        update(replyId, { streaming: false });
        if (!acc) update(replyId, { loading: false, content: "(tomt svar)" });
      }

      // Agenten kan ha endret seg selv via chatten — synk state + sidepanel.
      if (agent && chatIdRef.current) {
        fetchChatAgent(chatIdRef.current).then(setAgent).catch(() => {});
        window.dispatchEvent(new CustomEvent("nordavind:agents-changed"));
      }

      // Passivt kunnskaps-uttrekk fra utvekslingen (ikke agent/widget-bygging).
      if (acc && text && !agentModeRef.current && !widgetEditRef.current) {
        extractKnowledge({
          chat_id: chatIdRef.current ?? undefined,
          question: text,
          answer: acc,
        });
      }

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

  // Slash-meny: vises mens brukeren skriver en kommando (før mellomrom).
  // Innebygde handlinger (agent, ny widget) + brukerens widgets som /<slug>.
  const slashMatch = /^\/([a-z0-9-]*)$/i.exec(input);
  const slashPrefix = slashMatch?.[1].toLowerCase() ?? "";
  // /mail-modus: komboboksen viser innboks-tråder som menyelementer.
  const mailActive = /^\/mail(\s|$)/i.test(input);
  const mailQuery = input.replace(/^\/mail\s*/i, "").toLowerCase();
  const slashItems = mailActive
    ? mailThreads
        .filter(
          (t) =>
            !mailQuery ||
            t.subject.toLowerCase().includes(mailQuery) ||
            (t.from.name || t.from.address).toLowerCase().includes(mailQuery)
        )
        .map((t) => ({
          cmd: "mailthread:" + t.key,
          label: t.subject || "(uten emne)",
          desc: `${t.from.name || t.from.address} · ${new Date(t.date).toLocaleDateString("no-NO", { day: "2-digit", month: "short" })}${t.unread ? " · ulest" : ""}`,
          icon: AnonymousIcon,
        }))
    : slashMatch
      ? [
          ...SLASH_ACTIONS.filter((a) => a.cmd.startsWith(slashPrefix)),
          ...widgets
            .filter((w) => w.slug.startsWith(slashPrefix))
            .map((w) => ({
              cmd: w.slug,
              label: w.title || w.slug,
              desc: "Widget",
              icon: DashboardSquare01Icon,
            })),
        ]
      : [];
  const slashOpen = slashItems.length > 0;

  function pickSlash(cmd: string) {
    setSlashIndex(0);
    if (cmd.startsWith("mailthread:")) {
      renderMailInline(cmd.slice("mailthread:".length));
      return;
    }
    if (cmd === "mail") {
      // Åpne innboks-lista i komboboksen.
      setInput("/mail ");
      return;
    }
    if (cmd === "widget") {
      // La brukeren skrive navnet: "/widget <navn>".
      setInput("/widget ");
      return;
    }
    setInput("");
    send(`/${cmd}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlash(slashItems[slashIndex]?.cmd ?? slashItems[0].cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    setSlashIndex(0);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  const composer = (
    <div className={styles.composer}>
      {(attachments.length > 0 || uploadError) && (
        <div className={styles.attachRow}>
          {attachments.map((a) => (
            <span
              key={a.name}
              className={`${styles.attachChip} ${
                a.image ? styles.attachImageChip : ""
              }`}
            >
              {a.image ? (
                <img src={a.image} alt={a.name} className={styles.attachThumb} />
              ) : (
                a.name
              )}
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
      {slashOpen && (
        <div className={styles.slashBody}>
          <ul className={styles.slashList}>
            {slashItems.map((a, i) => (
              <li key={a.cmd}>
                <button
                  type="button"
                  className={`${styles.slashItem} ${
                    i === slashIndex ? styles.slashItemActive : ""
                  }`}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => pickSlash(a.cmd)}
                >
                  <HugeiconsIcon
                    icon={a.icon}
                    size={16}
                    className={styles.slashIcon}
                  />
                  <span className={styles.slashLabel}>{a.label}</span>
                  <span className={styles.slashHint}>{a.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.footer}>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.md,.csv,.json,.log,text/*,image/*"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          className={`${styles.actionBtn} ${styles.attachBtn}`}
          onClick={() => fileInputRef.current?.click()}
          title="Legg ved fil"
          aria-label="Legg ved fil"
        >
          <AttachIcon size={15} />
        </button>
        <span className={styles.modelInfo}>
          <span className={styles.modelLabel}>Modell:</span>{" "}
          {modelAlias(activeModel)}
          {modelDesc(activeModel) && ` - ${modelDesc(activeModel)}`}
        </span>
        <span className={styles.sendHint}>
          Send <span className={styles.kbd}>↵</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.chatRoot}>
      {title && (hasMessages || agent) && (
        <div
          className={`${styles.topbar} ${
            scrolledPast || agent ? styles.topbarVisible : ""
          }`}
        >
          {editingTitle ? (
            <input
              className={styles.titleInput}
              defaultValue={title}
              autoFocus
              maxLength={60}
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
          ) : (
            <span
              className={styles.titleText}
              onDoubleClick={() => setEditingTitle(true)}
              title="Dobbeltklikk for å endre"
            >
              {title}
            </span>
          )}
          {agent && (
            <button
              className={styles.agentPause}
              onClick={toggleAgentPause}
              title={agent.enabled ? "Sett agenten på pause" : "Gjenoppta agenten"}
              aria-label={agent.enabled ? "Pause agent" : "Gjenoppta agent"}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="10"
                  cy="10"
                  r="9.25"
                  fill={agent.enabled ? "#007EFF" : "#5b5b60"}
                  stroke={agent.enabled ? "#00CAFF" : "none"}
                  strokeWidth="0.75"
                />
                {agent.enabled ? (
                  <>
                    <rect x="7" y="6" width="2" height="8" rx="1" fill="white" />
                    <rect x="11" y="6" width="2" height="8" rx="1" fill="white" />
                  </>
                ) : (
                  <path d="M8 6.5 L14 10 L8 13.5 Z" fill="white" />
                )}
              </svg>
            </button>
          )}
          {agent && (
            <button
              className={styles.agentDelete}
              onClick={deleteThisAgent}
              title="Slett agent og chat"
              aria-label="Slett agent"
            >
              <HugeiconsIcon icon={Delete01Icon} size={16} strokeWidth={2} />
            </button>
          )}
          {agent && (
            <span className={styles.agentStats}>
              {agent.schedule_label && <span>{agent.schedule_label}</span>}
              {agent.daily_token_limit ? (
                <span>
                  ~{formatTokens(agent.daily_token_limit * 30)} tokens/mnd
                </span>
              ) : null}
            </span>
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
                  } ${isWidgetOnly(m.content) ? styles.widgetRow : ""}`}
                >
                  <div
                    className={`${styles.bubble} ${
                      m.error ? styles.error : ""
                    } ${isWidgetOnly(m.content) ? styles.widgetBubble : ""}`}
                  >
                    {m.content ? (
                      m.role === "assistant" && !m.error && !m.revealed ? (
                        <StreamingText
                          content={m.content}
                          done={!m.streaming}
                          onDone={() => update(m.id, { revealed: true })}
                        />
                      ) : m.role === "assistant" && !m.error ? (
                        <div className={styles.markdown}>
                          {(() => {
                            const ts =
                              agent &&
                              m.content.match(/^\*\*(.+?)\*\*\n\n([\s\S]*)$/);
                            return (
                              <>
                                {ts && (
                                  <div className={styles.agentStamp}>{ts[1]}</div>
                                )}
                                <Markdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{ a: SourceLink, pre: MarkdownPre }}
                                >
                                  {ts ? ts[2] : m.content}
                                </Markdown>
                              </>
                            );
                          })()}
                          {!m.streaming && !m.loading && (
                            <MessageActions
                              content={m.content}
                              sources={m.sources}
                              armed={correctionTarget?.id === m.id}
                              onArm={(content) =>
                                setCorrectionTarget((cur) =>
                                  cur?.id === m.id
                                    ? null
                                    : { id: m.id, content }
                                )
                              }
                            />
                          )}
                        </div>
                      ) : (
                        <>
                          {m.images && m.images.length > 0 && (
                            <span className={styles.attachRow}>
                              {m.images.map((src, i) => (
                                <img
                                  key={i}
                                  src={src}
                                  alt="Vedlagt bilde"
                                  className={styles.bubbleImage}
                                />
                              ))}
                            </span>
                          )}
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
