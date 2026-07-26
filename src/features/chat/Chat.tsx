import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentChatContext } from "../../tools/agent/MissionPlan";
import { DeckCanvas } from "../../tools/deck/DeckCanvas";
import { TableQueryContext } from "./blocks/core";

// Flyt-visningen lazy-lastes: den er kun for agent-chatter.
const AgentFlow = lazy(() => import("../agentflow/AgentFlow"));
import { Logo } from "../../ui/Logo";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Analytics01Icon,
  ChartRelationshipIcon,
  BubbleChatTemporaryIcon,
  Structure04Icon,
  DashboardSpeed01Icon,
  Database01Icon,
  AnonymousIcon,
  BorderNone02Icon,
  NeuralNetworkIcon,
  ArrowDown01Icon,
  Attachment01Icon,
  BadgePlusIcon,
  Files01Icon,
  FlashIcon,
  LayoutAlignLeftIcon,
  UserGroupIcon,
  UserSettings01Icon,
  Delete01Icon,
  Csv01Icon,
  Doc01Icon,
  HtmlFile01Icon,
  LottiefilesIcon,
  Pdf01Icon,
  Svg01Icon,
  Txt01Icon,
  Xls01Icon,
  Upload05Icon,
  Zip01Icon,
} from "@hugeicons/core-free-icons";
import { SearchIcon } from "../../ui/Icons";
import {
  connectM365,
  fetchM365Status,
  getImpersonation,
  setImpersonation,
  fetchTenantUsers,
  type TenantUser,
  apiConfigured,
  appendChatMessage,
  createChat,
  extractFile,
  fetchChatMessages,
  createWidget,
  listWidgets,
  type Widget,
  deleteAgent,
  extractKnowledge,
  fetchChatAgent,
  generateChatTitle,
  logCorrection,
  readImage,
  renameChat,
  setAgentEnabled,
  setAgentPush,
  type AgentInfo,
  streamChat,
  saveDocument,
  classifyDocument,
  type ApiMessage,
  type TableQuery,
  type Attachment,
  type ContentPart,
  type ChatSummary,
  type SourceRef,
} from "../../lib/api";
import "../../tools"; // registrerer alle verktøyenes fenced-blokker
import {
  MarkdownPre,
  StreamingText,
  MessageActions,
  SourceLink,
  thinkingLabel,
} from "./messageParts";
import { DEFAULT_MODEL, modelAlias, modelDesc, modelGlow } from "../../lib/models";
import { emit, on } from "../../lib/events";
import { swallow } from "../../lib/log";
import { formatTokens, nextId, isWidgetOnly, slugify, buildHistory, wantsAgentEdit, wantsSaveDocument } from "./chatHelpers";
import { FileTag } from "../../ui/FileTag";
import { useAnchoredScroll } from "./useAnchoredScroll";
import styles from "./Chat.module.css";

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
  /** Databasespørringen bak svaret (gir live Excel-eksport på tabeller) */
  query?: TableQuery;
}

// Filtype → ikon for vedleggs-tags.
const FILE_ICONS: Record<string, typeof AnonymousIcon> = {
  pdf: Pdf01Icon,
  txt: Txt01Icon,
  md: Txt01Icon,
  svg: Svg01Icon,
  csv: Csv01Icon,
  xls: Xls01Icon,
  xlsx: Xls01Icon,
  html: HtmlFile01Icon,
  htm: HtmlFile01Icon,
  doc: Doc01Icon,
  docx: Doc01Icon,
  zip: Zip01Icon,
};

function fileIcon(name: string): typeof AnonymousIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? LottiefilesIcon;
}

// Samme palett som epost-avatarene: svak bakgrunn + sterkere farge på ikonet.
const FILE_TAG_COLORS: [string, string][] = [
  ["#E6F2FF", "#2e6bad"],
  ["#CDFBFB", "#1f8a8a"],
  ["#D8FDE4", "#2f8a54"],
  ["#E8FDCA", "#5f7d1e"],
  ["#FDF2B2", "#94711a"],
  ["#FFE6E8", "#b0505a"],
  ["#EEEAFF", "#6152b3"],
];

// Stabil farge per filtype (hash av endelsen).
function fileTagColor(name: string): [string, string] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  let h = 0;
  for (let i = 0; i < ext.length; i++) h = (h * 31 + ext.charCodeAt(i)) >>> 0;
  return FILE_TAG_COLORS[h % FILE_TAG_COLORS.length];
}

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
    icon: BorderNone02Icon,
  },
  {
    cmd: "presentasjon",
    label: "Ny presentasjon",
    desc: "Bygg en presentasjon med live data",
    icon: BorderNone02Icon,
  },
];

// Kontekst-ring: fylles etter hvor mye av samtalens kontekstvindu som er
// brukt (estimat: ~3,5 tegn per token mot modellens vindu). Ren indikasjon.
const CONTEXT_TOKENS = 120_000;

function ContextRing({ messages }: { messages: { content: string }[] }) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const frac = Math.min(1, chars / 3.5 / CONTEXT_TOKENS);
  const R = 6;
  const C = 2 * Math.PI * R;
  const warn = frac > 0.8;
  return (
    <span
      className={styles.ctxRing}
      title={`~${Math.round(frac * 100)} % av kontekstvinduet brukt`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
        <circle
          cx="8" cy="8" r={R} fill="none"
          stroke={warn ? "#e6a23c" : "#949494"}
          strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform="rotate(-90 8 8)"
        />
      </svg>
    </span>
  );
}

// Admin-pille i composeren: viser hvem admin opptrer som, klikk åpner
// brukerliste — valgt bruker simuleres i alle data-kall til den slås av.
function ImpersonatePill() {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const imp = getImpersonation();

  async function toggle() {
    if (!open && users === null) {
      setUsers(await fetchTenantUsers().catch(() => []));
    }
    setOpen((o) => !o);
  }

  function pick(u: TenantUser | null) {
    setImpersonation(u ? { id: u.id, email: u.email } : null);
    // Full reload: hele tilstanden (chats, widgets, tilganger) skal arves.
    window.location.reload();
  }

  return (
    <span className={styles.impWrap}>
      <button
        className={`${styles.impTrigger} ${imp ? styles.impTriggerActive : ""}`}
        onClick={toggle}
        title="Velg hvem du vil opptre som"
      >
        {imp ? imp.email : "Admin"}
        <HugeiconsIcon icon={ArrowDown01Icon} size={13} strokeWidth={2} />
      </button>
      {open && (
        <span className={styles.impPop}>
          <button className={styles.impRow} onClick={() => pick(null)}>
            Admin (deg selv)
          </button>
          {users === null ? (
            <span className={styles.impEmpty}>Henter …</span>
          ) : (
            users.map((u) => (
              <button key={u.id} className={styles.impRow} onClick={() => pick(u)}>
                {u.email}
              </button>
            ))
          )}
        </span>
      )}
    </span>
  );
}

// Admin-styring i chatten: settings-panelene kalles inn som blokker.
const ADMIN_ACTIONS: { cmd: string; label: string; desc: string; icon: typeof AnonymousIcon }[] = [
  { cmd: "forbruk", label: "Forbruk", desc: "Token- og kostnadsoversikt", icon: Analytics01Icon },
  { cmd: "kunnskap", label: "Kunnskap", desc: "Bedriftskunnskapen AI-en husker", icon: NeuralNetworkIcon },
  { cmd: "dokumenter", label: "Dokumenter", desc: "Dokumentbiblioteket", icon: Files01Icon },
  { cmd: "ansatte", label: "Ansatte", desc: "Ansattregisteret", icon: UserGroupIcon },
  { cmd: "tilganger", label: "Brukere og tilganger", desc: "Administrer brukere", icon: UserSettings01Icon },
  { cmd: "tilkoblinger", label: "Tilkoblinger", desc: "Databaser og Microsoft 365", icon: Database01Icon },
  { cmd: "koble", label: "Ny tilkobling", desc: "Koble til en ny datakilde", icon: Database01Icon },
  { cmd: "graf", label: "Kunnskapsgraf", desc: "Grafen over bedriftskunnskapen", icon: ChartRelationshipIcon },
  { cmd: "kvote", label: "Kvote", desc: "Token-kvoter per bruker", icon: DashboardSpeed01Icon },
];

// Streamet tekst der hele ord fades inn i jevn takt, frikoblet fra
// nettverks-chunkenes rykkete ankomst. Ufullstendige ord holdes tilbake;
// markdown tar over når svaret er ferdig.
export function Chat({
  chatId,
  onStartAgent,
  initialTitle,
  onChatCreated,
  onTitleGenerated,
  userRole,
}: {
  chatId: string | null;
  onStartAgent?: () => void;
  initialTitle?: string | null;
  onChatCreated?: (chat: ChatSummary) => void;
  onTitleGenerated?: () => void;
  /** Rolle til innlogget bruker — styrer admin-kommandoene i slash-menyen. */
  userRole?: string;
}) {
  // Under simulering opptrer admin som en vanlig bruker også i UI-et —
  // admin-kommandoene skjules (pillen styres separat av ekte rolle).
  const effectiveRole = getImpersonation() ? "member" : userRole;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState<string | null>(initialTitle ?? null);
  // Agent bak denne chatten (for pause-knappen), null for vanlige chatter.
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  // Live-aktivitet fra et kjørende oppdrag teller som en «rad» i ankringen, så
  // scroll-hooken behandler den som siste melding (ikke strekker konklusjonen).
  const activityPresent =
    agent?.mission_status === "running" && !!agent?.mission_activity;
  // Scroll-ankring + topbar-fade eies av hooken; den gir ref til meldingslista.
  const { messagesRef, scrolledPast } = useAnchoredScroll(
    activityPresent ? [...messages, 0] : messages
  );
  // Inline-redigering av tittel (dobbeltklikk).
  const [editingTitle, setEditingTitle] = useState(false);
  // Flyt-visningen: agentens plan som redigerbar node-graf.
  const [showFlow, setShowFlow] = useState(false);
  const chatIdRef = useRef<string | null>(chatId);
  // Brukerens widgets — fyller slash-menyen (/<slug>) og kalles inline.
  const [widgets, setWidgets] = useState<Widget[]>([]);
  // Satt til en slug mens en widget bygges/redigeres i denne samtalen.
  const widgetEditRef = useRef<string | null>(null);
  // Åpent presentasjons-lerret: instrukser går stille til agenten som patcher
  // decket, og canvaset henter specen på nytt selv.
  const [deckCanvas, setDeckCanvas] = useState<string | null>(null);
  const deckCanvasRef = useRef<string | null>(null);
  // True etter et bart /widget: neste melding blir widget-beskrivelsen.
  const widgetPendingRef = useRef(false);

  function reloadWidgets() {
    listWidgets().then(setWidgets).catch(swallow);
  }
  useEffect(() => {
    reloadWidgets();
  }, []);
  // Lagret widget-utkast → /-menyen oppdateres med en gang.
  useEffect(() => on("widgets-changed", reloadWidgets), []);
  // Sendt e-post kvitteres som vanlig chatmelding i stedet for kort-tilstand.
  useEffect(
    () =>
      on("mail-sent", () => {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: "Epost sendt :)", revealed: true },
        ]);
        const cid = chatIdRef.current;
        if (cid) appendChatMessage(cid, { role: "assistant", content: "Epost sendt :)" }).catch(swallow);
      }),
    []
  );
  // Paneler kan sende en melding på brukerens vegne. Fast reply rendres
  // deterministisk — modellen er ikke involvert, så flyten er alltid lik.
  useEffect(
    () =>
      on("compose-send", ({ text, reply, intent }) => {
        if (intent === "connect") pendingConnectRef.current = true;
        if (reply) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "user", content: text, display: text, revealed: true },
            { id: nextId(), role: "assistant", content: reply, revealed: true },
          ]);
          const cid = chatIdRef.current;
          if (cid) {
            appendChatMessage(cid, { role: "user", content: text })
              .then(() => appendChatMessage(cid, { role: "assistant", content: reply }))
              .catch(swallow);
          }
          return;
        }
        send(text);
      }),
    // send er stabil nok her — lytteren registreres én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );


  function saveTitle(next: string) {
    setEditingTitle(false);
    const trimmed = next.trim().slice(0, 60);
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    const cid = chatIdRef.current;
    if (cid) renameChat(cid, trimmed).catch(swallow);
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
      .catch(swallow);
  }, [chatId]);

  // Slå opp om chatten tilhører en agent (viser pause-knapp i topbaren).
  useEffect(() => {
    if (!chatId) {
      setAgent(null);
      return;
    }
    fetchChatAgent(chatId).then(setAgent).catch(() => setAgent(null));
  }, [chatId]);

  // Agent-chat: poll etter nye agent-meldinger mens chatten er åpen, så et
  // trigget resultat dukker opp uten at brukeren må forlate og gå tilbake.
  // Kun én lett henting hvert 15. sek, aldri under streaming.
  useEffect(() => {
    if (!chatId || !agent) return;
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      fetchChatMessages(chatId)
        .then((stored) =>
          setMessages((prev) => {
            if (busyRef.current || stored.length <= prev.length) return prev;
            const tail = stored.slice(prev.length).map((m) => ({
              id: nextId(),
              role: m.role,
              content: m.content,
              sources: m.sources ? JSON.parse(m.sources) : undefined,
              revealed: true,
            }));
            return [...prev, ...tail];
          })
        )
        .catch(swallow);
    }, agent.mission ? 3000 : 15000);
    return () => window.clearInterval(id);
  }, [chatId, agent]);

  // Oppdrags-agent: poll agenten raskt så live-aktiviteten («hva jeg gjør»)
  // fanges opp med en gang den starter og holdes fersk til oppdraget er ferdig.
  // Poller også mens den er draft (ennå ikke «done»), for å fange overgangen til
  // «running» straks brukeren trykker Start.
  useEffect(() => {
    if (!chatId || !agent || agent.mission_status === "done") return;
    const id = window.setInterval(async () => {
      if (busyRef.current) return;
      // Hent agent OG meldinger i samme tikk: da dukker konklusjonen opp i
      // nøyaktig samme render som aktiviteten forsvinner — ingen dødt mellomrom.
      const [a, stored] = await Promise.all([
        fetchChatAgent(chatId).catch(() => null),
        fetchChatMessages(chatId).catch(() => null),
      ]);
      if (stored) {
        setMessages((prev) => {
          if (busyRef.current || stored.length <= prev.length) return prev;
          const tail = stored.slice(prev.length).map((m) => ({
            id: nextId(),
            role: m.role,
            content: m.content,
            sources: m.sources ? JSON.parse(m.sources) : undefined,
            revealed: true,
          }));
          return [...prev, ...tail];
        });
      }
      if (a) setAgent(a);
    }, 1500);
    return () => window.clearInterval(id);
  }, [chatId, !!agent, agent?.mission_status]);

  // Live-aktivitet fra en kjørende oppdrags-agent (tanke + verktøysteg).
  const activity =
    agent?.mission_status === "running" && agent.mission_activity
      ? (() => {
          try {
            return JSON.parse(agent.mission_activity) as {
              thought?: string;
              steps?: string[];
            };
          } catch {
            return null;
          }
        })()
      : null;

  async function toggleAgentPause() {
    if (!agent) return;
    const next = !agent.enabled;
    setAgent({ ...agent, enabled: next });
    try {
      await setAgentEnabled(agent.id, next);
      emit("agents-changed");
    } catch {
      setAgent({ ...agent, enabled: !next });
    }
  }

  async function togglePush() {
    if (!agent) return;
    const next = !agent.push_enabled;
    setAgent({ ...agent, push_enabled: next });
    try {
      await setAgentPush(agent.id, next);
    } catch {
      setAgent({ ...agent, push_enabled: !next });
    }
  }

  async function deleteThisAgent() {
    if (!agent) return;
    if (!confirm(`Slette agenten «${agent.name}» og chatten?`)) return;
    try {
      await deleteAgent(agent.id);
      emit("agents-changed");
      emit("chat-deleted", chatId ?? undefined);
    } catch {
      // ignorer; brukeren kan prøve igjen
    }
  }

  const [input, setInput] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  // Bris er standard til backend melder hvilken modell som faktisk svarte.
  const [activeModel, setActiveModel] = useState<string | null>(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  // Speiler busy til en ref så poll-intervallet kan lese ferskeste verdi.
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Forslag om å lagre et vedlagt dokument i kunnskapsbasen, knyttet til
  // brukermeldingen det gjelder.
  const [trainOffer, setTrainOffer] = useState<{ id: string; docs: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Armert svar: neste brukermelding logges som korrigering på dette svaret.
  const [correctionTarget, setCorrectionTarget] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // /agent slår på agent-oppsettmodus for resten av denne samtalen, så
  // modellen beholder verktøyene gjennom hele den flerstegs-samtalen.
  const agentModeRef = useRef(false);
  // M365-innlogging: lenke fra connect_m365-verktøyet vises over composeren.
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  // Satt etter «Hva skal vi koble til?» — neste melding intent-ruters
  // deterministisk (M365 rett til OAuth, databaser til agenten).
  const pendingConnectRef = useRef(false);
  // Åpent lerret teller som samtale i gang: composeren skal ligge nederst,
  // ikke sentrert under presentasjonen.
  const hasMessages = messages.length > 0 || deckCanvas !== null;

  useEffect(() => () => abortRef.current?.abort(), []);

  // Kortet i chatten åpner presentasjonen på lerretet igjen.
  useEffect(
    () =>
      on("deck-open", (slug) => {
        deckCanvasRef.current = slug;
        setDeckCanvas(slug);
      }),
    []
  );

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

  // Drag & drop fra filsystemet: overlegg med «Slipp …» så lenge en fil
  // dras over vinduet; slipp legger den på som vedlegg.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (++dragDepth.current === 1) setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
    // handleFiles leser attachments-lengden — re-registrer når den endres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.length]);

  // Cmd/Ctrl+V med bilde i utklippstavlen: legg det rett på som vedlegg.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length === 0) return; // vanlig tekst-lim: la browseren gjøre sitt
    e.preventDefault();
    const dt = new DataTransfer();
    const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
    imgs.forEach((f, i) => {
      const ext = f.type.split("/")[1] || "png";
      const name =
        f.name && f.name !== "image.png"
          ? f.name
          : `skjermbilde-${stamp}${i ? `-${i + 1}` : ""}.${ext}`;
      dt.items.add(new File([f], name, { type: f.type }));
    });
    handleFiles(dt.files);
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

  // Bruker takket ja til å trene modellen på det vedlagte dokumentet: lagre og
  // bekreft, uten en ny brukermelding.
  async function acceptTrain() {
    const offer = trainOffer;
    if (!offer) return;
    setTrainOffer(null);
    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: replyId, role: "assistant", content: "", loading: true },
    ]);
    try {
      const saved = await Promise.all(
        offer.docs.map((d) =>
          saveDocument({ filename: d.name, text: d.text, chat_id: chatIdRef.current ?? undefined })
        )
      );
      const titles = saved.map((s) => `«${s.title}»`).join(", ");
      const content = `Lagret ${titles} i kunnskapsbasen. Jeg bruker det automatisk framover.`;
      update(replyId, { loading: false, content, revealed: true });
      const cid = chatIdRef.current;
      if (cid) appendChatMessage(cid, { role: "assistant", content }).catch(swallow);
    } catch (e) {
      update(replyId, {
        loading: false,
        error: true,
        content: "Kunne ikke lagre: " + (e instanceof Error ? e.message : "ukjent feil"),
      });
    }
  }

  function dismissTrain() {
    setTrainOffer(null);
  }

  // Lagrer vedlagte dokumenter som bedriftskunnskap. Ingen LLM-tur: teksten er
  // alt uttrukket, backend chunker/embedder og indekserer.
  async function saveDocsInline(raw: string, docs: Attachment[]) {
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setAttachments([]);
    const names = docs.map((d) => d.name).join(", ");
    const replyId = nextId();
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "user",
        content: raw,
        display: raw,
        attachmentNames: docs.map((d) => d.name),
        revealed: true,
      },
      { id: replyId, role: "assistant", content: "", loading: true },
    ]);
    // Sørg for en chat å knytte dokumentet til.
    if (!chatIdRef.current) {
      try {
        const chat = await createChat(raw.slice(0, 60) || names);
        chatIdRef.current = chat.id;
        onChatCreated?.(chat);
      } catch {
        // persistens ikke kritisk
      }
    }
    try {
      const saved = await Promise.all(
        docs.map((d) =>
          saveDocument({ filename: d.name, text: d.text, chat_id: chatIdRef.current ?? undefined })
        )
      );
      const titles = saved.map((s) => `«${s.title}»`).join(", ");
      const content = `Lagret ${titles} som bedriftskunnskap. Jeg bruker det automatisk når det er relevant.`;
      update(replyId, { loading: false, content, revealed: true });
      const cid = chatIdRef.current;
      if (cid) {
        appendChatMessage(cid, { role: "user", content: `${raw} [${names}]` })
          .then(() => appendChatMessage(cid, { role: "assistant", content }))
          .catch(swallow);
      }
    } catch (e) {
      update(replyId, {
        loading: false,
        error: true,
        content: "Kunne ikke lagre dokumentet: " + (e instanceof Error ? e.message : "ukjent feil"),
      });
    }
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
        .catch(swallow);
    }
  }

  // Kaller et admin-panel inline i chatten: ingen LLM, bare en
  // ```admin <panel>```-blokk som rendrer settings-komponenten der og da.
  async function renderAdminInline(raw: string, panel: string) {
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const block = "```admin\n" + panel + "\n```";
    if (!chatIdRef.current) {
      try {
        const chat = await createChat(`/${panel}`);
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
        .then(() => appendChatMessage(cid, { role: "assistant", content: block }))
        .catch(swallow);
    }
  }

  async function send(overrideText?: string) {
    const raw = (overrideText ?? input).trim();
    if ((!raw && attachments.length === 0) || busy) return;

    // Vedlagt dokument + lagre-intensjon: lagre som bedriftskunnskap, ingen LLM-tur.
    const docs = attachments.filter((a) => !a.image && a.text.trim());
    if (docs.length > 0 && wantsSaveDocument(raw)) {
      await saveDocsInline(raw, docs);
      return;
    }

    // /<slug>: en kjent widget kalt inline — render den, ingen LLM-tur.
    const firstTok = /^\/([a-z0-9-]+)/i.exec(raw)?.[1]?.toLowerCase();
    // Deterministisk connect-ruting: svar på «Hva skal vi koble til?».
    // Slash-kommandoer vinner alltid — de avbryter den ventende flyten.
    if (pendingConnectRef.current && !raw.startsWith("/")) {
      pendingConnectRef.current = false;
      if (/m365|microsoft|365|outlook|onedrive|sharepoint/i.test(raw)) {
        setInput("");
        const userId = nextId();
        const replyId = nextId();
        setMessages((prev) => [
          ...prev,
          { id: userId, role: "user", content: raw, display: raw, revealed: true },
          { id: replyId, role: "assistant", content: "", loading: true },
        ]);
        try {
          const st = await fetchM365Status();
          if (st.connected) {
            update(replyId, {
              loading: false,
              content: `Microsoft 365 er allerede koblet til som ${st.email}.`,
              revealed: true,
            });
          } else {
            const { url } = await connectM365();
            setAuthUrl(url);
            window.open(url, "_blank", "width=520,height=680");
            update(replyId, {
              loading: false,
              content: "Logg inn i Microsoft-vinduet (knappen over feltet hvis det ikke åpnet seg) — jeg sier fra når koblingen er bekreftet.",
              revealed: true,
            });
            const t = window.setInterval(async () => {
              const st2 = await fetchM365Status().catch(() => null);
              if (st2?.connected) {
                window.clearInterval(t);
                setAuthUrl(null);
                emit("connections-changed");
                setMessages((prev) => [
                  ...prev,
                  { id: nextId(), role: "assistant", content: `Microsoft 365 er koblet til som ${st2.email} ✓`, revealed: true },
                ]);
              }
            }, 2000);
            window.setTimeout(() => window.clearInterval(t), 180000);
          }
        } catch {
          update(replyId, { loading: false, error: true, content: "Kunne ikke starte Microsoft-innloggingen." });
        }
        return;
      }
      // Ikke M365: spawn credential-skjemaet direkte — svaret re-rutes ALDRI
      // via intent-motoren (feilstavinger som «datbase» droppet hele flyten).
      setInput("");
      const drv = /mysql/i.test(raw) ? "mysql" : /mssql|sql ?server/i.test(raw) ? "mssql" : "postgres";
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: raw, display: raw, revealed: true },
        {
          id: nextId(),
          role: "assistant",
          content: "Fyll inn tilkoblingen her — passordet går kryptert utenom chatten. Lurer du på noe underveis, bare spør.\n```credential\n" + JSON.stringify({ driver: drv }) + "\n```",
          revealed: true,
        },
      ]);
      return;
    }

    // En slash-kommando avbryter en ventende connect-flyt permanent.
    if (raw.startsWith("/")) pendingConnectRef.current = false;

    // /koble: start ny tilkobling deterministisk (samme løype som panelknappen).
    if (firstTok === "koble" && effectiveRole === "admin") {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      pendingConnectRef.current = true;
      emit("compose-send", { text: "Opprett en ny kobling", reply: "Hva skal vi koble til?", intent: "connect" });
      return;
    }

    // Admin-panelene rendres inline på samme måte som widgets.
    const adminAct =
      effectiveRole === "admin"
        ? ADMIN_ACTIONS.find((a) => a.cmd === firstTok)
        : undefined;
    if (adminAct) {
      await renderAdminInline(raw, adminAct.cmd);
      return;
    }
    if (firstTok && firstTok !== "widget" && firstTok !== "agent") {
      const w = widgets.find((x) => x.slug === firstTok);
      if (w) {
        await renderWidgetInline(raw, w.slug);
        return;
      }
    }

    // /agent spawner en fersk agent-chat (ekte agent-tråd i sidebar) og lander
    // brukeren der. Ingen AI, ingen tolkning her.
    if (/^\/agent\b/i.test(raw)) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onStartAgent?.();
      return;
    }

    // /presentasjon [beskrivelse]: åpne lerretet med en gang og hopp over
    // intent-rutingen. Uten beskrivelse står lerretet tomt og venter på
    // første instruks. Naturlig språk («lag en presentasjon om …») havner
    // samme sted via intent-motoren.
    if (/^\/(presentasjon|presentation)\b/i.test(raw) && !deckCanvasRef.current) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      const rest = raw.replace(/^\/(presentasjon|presentation)\s*/i, "").trim();
      // Alltid en fersk slug: uten suffikset kolliderte «presentasjon» med
      // forrige deck, og lerretet åpnet den gamle presentasjonen i stedet.
      const name = `${rest.slice(0, 48) || "presentasjon"}-${Date.now().toString(36)}`;
      let slug: string;
      try {
        slug = (await createWidget(name)).slug;
      } catch {
        // Opprettelsen feilet: ikke gjett på en slug som kan tilhøre et annet
        // deck — la brukeren få vite det i stedet.
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: "Klarte ikke opprette presentasjonen. Prøv en gang til.",
            error: true,
            revealed: true,
          },
        ]);
        return;
      }
      deckCanvasRef.current = slug;
      setDeckCanvas(slug);
      reloadWidgets();
      if (!rest) return; // tomt lerret — vent på instruks
      return send(rest);
    }

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

    // Opprett widget når vi har en beskrivelse. Et nytt eksplisitt /widget
    // starter ALLTID en fersk widget — ellers skrev agenten den nye specen
    // inn i forrige widget og ignorerte brukeren.
    const buildingWidget = (isWidgetCmd || widgetPendingRef.current) && !!widgetDesc;
    if (buildingWidget && isWidgetCmd) widgetEditRef.current = null;
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

    const text = buildingWidget ? widgetDesc : raw;

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

    const deckTurn = deckCanvasRef.current;
    // Presentasjons-tur: instruksen står aldri i chat-tråden. Modellen får kun
    // instruksen — hva som allerede ligger på lerretet henter backend fra
    // specen (deterministisk), ikke fra meldingshistorikken.
    const history = deckTurn
      ? [{ role: "user" as const, content: apiContent }]
      : buildHistory(messages, { role: "user", content: apiContent });

    // Widget-tur: svaret ER widgeten. På skapelsesturen settes blokka med én
    // gang så vind-animasjonen starter umiddelbart. Senere turer kan være ren
    // prat («Takk») — da venter vi og viser widgeten kun hvis specen faktisk
    // ble endret (nordavind_widget_updated fra backend).
    const widgetTurnSlug = widgetEditRef.current;
    const widgetBlock = widgetTurnSlug
      ? "```widget\n" + widgetTurnSlug + "\n```"
      : "";
    const presetWidget = !!widgetTurnSlug && buildingWidget;

    const userMsgId = nextId();
    const replyId = nextId();
    if (deckTurn) {
      // Lerretet ER samtalen: ingen bobler, kun arbeids-puls på slidene.
      emit("deck-working", deckTurn);
    } else {
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
        presetWidget
          ? { id: replyId, role: "assistant", content: widgetBlock, revealed: true }
          : { id: replyId, role: "assistant", content: "", loading: true },
      ]);
    }

    // Vanlig dokument-vedlegg (ikke widget/agent): la agenten billig vurdere om
    // dette er verdifull, gjenbrukbar kunnskap før vi tilbyr lagring — så
    // brukeren kun spørres om det som er verdt å huske. Ett lite kall, async.
    const trainDocs = files.filter((a) => !a.image && a.text.trim());
    if (trainDocs.length > 0 && !widgetTurnSlug && !agentModeRef.current) {
      classifyDocument(trainDocs[0].name, trainDocs[0].text)
        .then((save) => {
          if (save) setTrainOffer({ id: userMsgId, docs: trainDocs });
        })
        .catch(swallow);
    }

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
      let widgetTouched = false;
      let resolved: string | undefined;
      let tableQuery: TableQuery | undefined;
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
          if (delta.query) tableQuery = delta.query;
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
          if (delta.widgetUpdated) widgetTouched = true;
          if (delta.deckUpdated) {
            // Første patch oppretter decket: åpne lerretet med en gang.
            if (!deckCanvasRef.current) {
              deckCanvasRef.current = delta.deckUpdated;
              setDeckCanvas(delta.deckUpdated);
            }
            emit("deck-updated", delta.deckUpdated);
            reloadWidgets();
          }
          if (delta.m365Auth) {
            setAuthUrl(delta.m365Auth);
            window.open(delta.m365Auth, "_blank", "width=520,height=680");
            const t = window.setInterval(async () => {
              const st = await fetchM365Status().catch(() => null);
              if (st?.connected) {
                window.clearInterval(t);
                setAuthUrl(null);
                emit("connections-changed");
              }
            }, 2000);
            window.setTimeout(() => window.clearInterval(t), 180000);
          }
          if (delta.connectionCreated) {
            setAuthUrl(null);
            emit("connections-changed");
          }
          // Forhåndssatt widget-blokk: ikke rør svaret — animasjonen står til
          // data er klar. Senere widget-turer streamer som vanlig og avgjøres
          // ved slutt (widget vs. tekstsvar).
          if (presetWidget || deckTurn) return;
          update(replyId, {
            loading: !acc && !think && steps.length === 0,
            content: acc,
            reasoning: acc ? undefined : think,
            streaming: true,
            resolvedModel: resolved,
            sources: [...sources],
            steps: [...steps],
            query: tableQuery,
          });
        },
        abortRef.current.signal,
        {
          agentSetup: agentModeRef.current,
          // Draft-agent (ikke godkjent ennå): kjør alltid oppdrags-planlegging.
          // Ferdig agent: kun når meldingen faktisk ber om en endring.
          agentEdit:
            agent?.id && (!agent.criteria_approved || wantsAgentEdit(text))
              ? agent.id
              : undefined,
          widget: widgetEditRef.current ?? undefined,
          deck: deckCanvasRef.current ?? undefined,
        }
      );
      // Widget-tur: vis widgeten kun når specen faktisk ble endret denne turen.
      // Ren prat («Takk») får modellens tekstsvar i stedet for en ny widget.
      if (deckTurn) {
        // Lerretet viser resultatet — ingenting skal legges i chat-tråden.
        reloadWidgets();
      } else if (widgetTurnSlug) {
        if (presetWidget || widgetTouched) {
          acc = widgetBlock;
          update(replyId, { loading: false, streaming: false, content: widgetBlock, revealed: true });
        } else {
          acc = acc || "Ok.";
          update(replyId, { loading: false, streaming: false, content: acc });
        }
        reloadWidgets();
      } else {
        update(replyId, { streaming: false });
        if (!acc) update(replyId, { loading: false, content: "(tomt svar)" });
      }

      // Agenten kan ha endret seg selv via chatten — synk state + sidepanel.
      if (agent && chatIdRef.current) {
        fetchChatAgent(chatIdRef.current).then(setAgent).catch(swallow);
        emit("agents-changed");
      }

      // Passivt kunnskaps-uttrekk fra utvekslingen (ikke agent/widget-bygging).
      // Hopp over korte meldinger uten substans; backend gater videre på
      // bedriftsinterne markører før den bruker et LLM-kall.
      if (acc && text.trim().length >= 40 && !agentModeRef.current && !widgetEditRef.current && !deckTurn) {
        extractKnowledge({
          chat_id: chatIdRef.current ?? undefined,
          question: text,
          answer: acc,
        });
      }

      // Persister utvekslingen (vedleggstekst lagres ikke, kun navn).
      if (chatIdRef.current && acc && !deckTurn) {
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
          .catch(swallow);
        if (isFirstExchange) {
          generateChatTitle(cid, text, acc)
            .then((t) => {
              setTitle(t);
              onTitleGenerated?.();
            })
            .catch(swallow);
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      if (deckTurn) {
        // Ingen boble å feile i: stopp pulsen og la lerretet stå som det var.
        emit("deck-updated", deckTurn);
        return;
      }
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
  const slashItems = slashMatch
    ? [
        ...SLASH_ACTIONS.filter((a) => a.cmd.startsWith(slashPrefix)),
        // Hele admin-styringen er kun for admin (og skjules under simulering).
        ...(effectiveRole === "admin"
          ? ADMIN_ACTIONS.filter((a) => a.cmd.startsWith(slashPrefix)).map(
              (a) => ({ ...a, tag: "Admin" })
            )
          : []),
        ...widgets
          .filter((w) => w.slug.startsWith(slashPrefix))
          .map((w) => ({
            cmd: w.slug,
            label: w.title || w.slug,
            desc: "Widget",
            icon: BorderNone02Icon,
          })),
      ]
    : [];
  const slashOpen = slashItems.length > 0;

  function pickSlash(cmd: string) {
    setSlashIndex(0);
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
    <>
      {authUrl && (
        <div className={styles.attachTagRow}>
          <a
            className={styles.authButton}
            href={authUrl}
            target="_blank"
            rel="noreferrer"
          >
            Åpne Microsoft-innlogging
          </a>
        </div>
      )}
      {/* Vedlegg som tags OVER composeren — fil-ikon + navn + fjern. */}
      {(attachments.length > 0 || uploadError) && (
        <div className={styles.attachTagRow}>
          {attachments.map((a) =>
            a.image ? (
              <span key={a.name} className={styles.attachTag}>
                <img src={a.image} alt="" className={styles.attachTagIcon} />
                <span className={styles.attachTagName}>{a.name}</span>
                <button
                  className={styles.attachRemove}
                  onClick={() => setAttachments((prev) => prev.filter((x) => x !== a))}
                  aria-label={`Fjern ${a.name}`}
                >
                  ×
                </button>
              </span>
            ) : (
              <FileTag
                key={a.name}
                name={a.name}
                onRemove={() => setAttachments((prev) => prev.filter((x) => x !== a))}
              />
            )
          )}
          {uploadError && (
            <span className={styles.attachError}>{uploadError}</span>
          )}
        </div>
      )}
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
          onPaste={handlePaste}
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
                  {"tag" in a && typeof a.tag === "string" && (
                    <span className={styles.slashTag}>{a.tag}</span>
                  )}
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
          accept=".pdf,.docx,.txt,.md,.csv,.json,.log,text/*,image/*"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          className={`${styles.actionBtn} ${styles.attachBtn}`}
          onClick={() => fileInputRef.current?.click()}
          title="Legg ved fil"
          aria-label="Legg ved fil"
        >
          <HugeiconsIcon icon={Attachment01Icon} size={16} strokeWidth={2} />
        </button>
        {userRole === "admin" && <ImpersonatePill />}
        <span className={styles.footerRight}>
          <ContextRing messages={messages} />
          <span className={styles.modelInfo}>
            <HugeiconsIcon icon={FlashIcon} size={13} strokeWidth={2} />
            <span className={styles.modelName}>{modelAlias(activeModel)}</span>
            {modelDesc(activeModel) && (
              <span className={styles.modelHint}>{modelDesc(activeModel)}</span>
            )}
          </span>
        </span>
      </div>
    </div>
    </>
  );

  return (
    <AgentChatContext.Provider value={agent?.id ?? null}>
    <div className={styles.chatRoot}>
      {deckCanvas && (
        <DeckCanvas
          slug={deckCanvas}
          onClose={() => {
            setDeckCanvas(null);
            deckCanvasRef.current = null;
          }}
        />
      )}
      {dragging && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropHint}>
            <HugeiconsIcon icon={Upload05Icon} size={40} strokeWidth={1.5} />
            <span>Slipp for å legge ved</span>
          </div>
        </div>
      )}
      <div
        className={`${styles.topbar} ${styles.topbarVisible} ${
          scrolledPast ? styles.topbarScrolled : ""
        }`}
      >
        <button
          className={styles.headerBtn}
          onClick={() => emit("sidebar-toggle")}
          aria-label="Vis/skjul sidemeny"
          title="Vis/skjul sidemeny (⌘B)"
        >
          <HugeiconsIcon icon={LayoutAlignLeftIcon} size={17} strokeWidth={2} />
        </button>
        <button
          className={styles.headerBtn}
          onClick={() => emit("new-chat")}
          aria-label="Ny chat"
          title="Ny chat (⌘N)"
        >
          <HugeiconsIcon icon={BadgePlusIcon} size={17} strokeWidth={2} />
        </button>
        {title && (hasMessages || agent) && (
          <>
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
              className={styles.agentPush}
              onClick={togglePush}
              title={
                agent.push_enabled
                  ? "Push-varsel på: du varsles når agenten finner noe verdt å vite"
                  : "Send push når agenten finner noe verdt å vite"
              }
              aria-label={agent.push_enabled ? "Skru av push" : "Skru på push"}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 2.5c-2.5 0-4 1.8-4 4.2 0 3.4-1.3 4.6-1.8 5.1-.3.3-.1.9.4.9h10.8c.5 0 .7-.6.4-.9-.5-.5-1.8-1.7-1.8-5.1 0-2.4-1.5-4.2-4-4.2Z"
                  fill={agent.push_enabled ? "#007EFF" : "none"}
                  stroke={agent.push_enabled ? "#00CAFF" : "currentColor"}
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 16a1.5 1.5 0 0 0 3 0"
                  stroke={agent.push_enabled ? "#00CAFF" : "currentColor"}
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {agent && (
            <button
              className={styles.agentPause}
              onClick={() => setShowFlow((v) => !v)}
              title={showFlow ? "Tilbake til chatten" : "Se og rediger agentens flyt"}
              aria-label={showFlow ? "Tilbake til chat" : "Agentflyt"}
            >
              <HugeiconsIcon
                icon={showFlow ? BubbleChatTemporaryIcon : Structure04Icon}
                size={18}
                strokeWidth={1.8}
              />
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
          </>
        )}
      </div>
      {showFlow && agent ? (
        <Suspense fallback={null}>
          <AgentFlow agentId={agent.id} onClose={() => setShowFlow(false)} />
        </Suspense>
      ) : hasMessages ? (
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
                    } ${isWidgetOnly(m.content) ? styles.widgetBubble : ""} ${
                      trainOffer?.id === m.id ? styles.bubbleOffer : ""
                    }`}
                  >
                  <TableQueryContext.Provider value={m.query ?? null}>
                    {/* Arbeids-indikator: står HELE tiden streamen er åpen, også
                        når litt innhold alt har kommet — så den aldri «forsvinner». */}
                    {m.role === "assistant" &&
                      !m.error &&
                      (m.streaming || m.loading) && (
                        <div className={styles.timeline}>
                          <div className={styles.step}>
                            <span className={styles.thinkingLogo}>
                              <Logo
                                size={10}
                                flutter
                                glow={modelGlow(m.resolvedModel ?? null)}
                              />
                            </span>
                            <span
                              className={`${styles.stepActive} ${styles.textShimmer}`}
                              style={{ "--shimmer-glow": modelGlow(m.resolvedModel ?? null) } as React.CSSProperties}
                            >
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
                      )}
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
                                  <span key={name} className={styles.attachTag}>
                                    <span
                                      className={styles.attachTagIconBox}
                                      style={{
                                        background: fileTagColor(name)[0],
                                        color: fileTagColor(name)[1],
                                      }}
                                    >
                                      <HugeiconsIcon icon={fileIcon(name)} size={14} strokeWidth={2} />
                                    </span>
                                    <span className={styles.attachTagName}>{name}</span>
                                  </span>
                                ))}
                              </span>
                            )}
                        </>
                      )
                    ) : null}
                  </TableQueryContext.Provider>
                  </div>
                  {trainOffer?.id === m.id && (
                    <div className={styles.trainOffer}>
                      <span className={styles.trainOfferText}>
                        Tren modellen på dette?
                      </span>
                      <button
                        type="button"
                        className={styles.trainYes}
                        onClick={acceptTrain}
                      >
                        Ja
                      </button>
                      <button
                        type="button"
                        className={styles.trainNo}
                        onClick={dismissTrain}
                      >
                        Nei
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {activity && (
                <div
                  className={styles.activityRow}
                  data-role="assistant"
                  data-mid="activity"
                >
                  <div className={styles.timeline}>
                    <div className={styles.step}>
                      <span className={styles.thinkingLogo}>
                        <Logo size={10} flutter />
                      </span>
                      <span className={`${styles.stepActive} ${styles.activityThought} ${styles.textShimmer}`}>
                        {activity.thought?.trim() || "Tenker"} …
                      </span>
                    </div>
                    {activity.steps && activity.steps.length > 0 && (
                      <div>
                        <span className={styles.stepLine} />
                        <div className={styles.step}>
                          <span className={styles.stepIcon}>
                            <SearchIcon size={14} />
                          </span>
                          <span className={`${styles.reasoning} ${styles.activityStep}`}>
                            {activity.steps[activity.steps.length - 1]}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
    </AgentChatContext.Provider>
  );
}
