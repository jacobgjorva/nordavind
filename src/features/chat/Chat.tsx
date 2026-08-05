import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentChatContext } from "../../tools/agent/MissionPlan";
import { Composer } from "./Composer";
import { searchEntities, type BrainEntity } from "../../lib/api";
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
  DatabaseIcon,
  CursorProgress01Icon,
  SnailIcon,
  AnonymousIcon,
  BorderNone02Icon,
  ArrowDown01Icon,
  BadgePlusIcon,
  Files01Icon,
  LayoutAlignLeftIcon,
  UserGroupIcon,
  UserSettings01Icon,
  Delete01Icon,
  Mail01Icon,
  Link01Icon,
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
  SdCardIcon,
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
  rememberMessage,
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
  orgMe,
  type OrgMe,
} from "../../lib/api";
import "../../tools"; // registrerer alle verktøyenes fenced-blokker
import {
  MarkdownPre,
  StreamingText,
  MessageActions,
  SourceLink,
  thinkingLabel,
} from "./messageParts";
import {
  DEFAULT_MODEL,
  modelAlias,
  modelDesc,
  modelGlow,
} from "../../lib/models";
import { emit, on } from "../../lib/events";
import { swallow } from "../../lib/log";
import {
  formatTokens,
  nextId,
  isWidgetOnly,
  slugify,
  buildHistory,
  formatAnswer,
  normalizeFences,
  markKeySentence,
  wantsAgentEdit,
  wantsSaveDocument,
  HISTORY_WINDOW,
  HISTORY_CHAR_BUDGET,
} from "./chatHelpers";
import { FileTag } from "../../ui/FileTag";
import { useAnchoredScroll } from "./useAnchoredScroll";
import styles from "./Chat.module.css";

/** Ett steg i arbeidstidslinjen. `kind` kommer fra backendens narrasjons-
 *  register og velger ikon; ukjente verdier faller tilbake til søkeikonet. */
interface ChatStep {
  text: string;
  kind?: string;
}

/** Et svar er en KRONOLOGISK rekke av segmenter: motoren skriver tekst mellom
 *  rundene (motor3.go emitter «tanken» før arbeidet fortsetter), så arbeidet
 *  må legge seg UNDER teksten som kom før det — ikke samles i én blokk på
 *  toppen. Hvert segment er enten tekst eller en stegblokk. */
type ChatPart =
  { kind: "text"; text: string } | { kind: "steps"; steps: ChatStep[] };

/** Segmentene for visning. Meldinger uten segmenter (widget-turer, historikk
 *  fra serveren) faller tilbake til hele innholdet som ett tekstsegment. */
function partsOf(m: ChatMessage): ChatPart[] {
  if (m.parts?.length) return m.parts;
  return m.content ? [{ kind: "text", text: m.content }] : [];
}

// Stegtype → ikon. Holdes i takt med kind-konstantene i backendens narrate.go.
// "web" står med vilje ikke her: SearchIcon er fallbacken i StepIcon, og det
// er riktig ikon for et søk.
const STEP_ICONS: Record<string, typeof Database01Icon> = {
  db: DatabaseIcon,
  table: Analytics01Icon,
  file: Files01Icon,
  mail: Mail01Icon,
  link: Link01Icon,
  agent: UserGroupIcon,
  // "click" er når assistenten går inn på en side og leser den, altså det
  // nærmeste et klikk. Søk beholder søkeikonet; dette bryter bare opp
  // nettarbeidet så tidslinjen ikke blir én lang rekke forstørrelsesglass.
  click: CursorProgress01Icon,
  // Ventemeldinger, uansett hvilket verktøy som drøyer.
  slow: SnailIcon,
};

function StepIcon({ kind }: { kind?: string }) {
  const icon = kind ? STEP_ICONS[kind] : undefined;
  if (!icon) return <SearchIcon size={14} />;
  return <HugeiconsIcon icon={icon} size={14} strokeWidth={1.8} />;
}

/** Linjen som pulserer mens modellen jobber. Den står ALLTID nederst i det
 *  som er skrevet så langt — aldri over en melding som alt er kommet. */
function ActiveStep({ label, glow }: { label: string; glow?: string }) {
  return (
    <div className={styles.step}>
      <span className={styles.thinkingLogo}>
        <Logo size={10} flutter glow={glow} />
      </span>
      <span
        className={`${styles.stepActive} ${styles.textShimmer}`}
        style={{ "--shimmer-glow": glow } as React.CSSProperties}
      >
        {label} …
      </span>
    </div>
  );
}

/** Hvor mange steg som står synlig mens turen løper. Resten glir ut i toppen;
 *  hele lista ligger i «Arbeidet (n steg)» når svaret er ferdig. */
const VISIBLE_STEPS = 3;

/** Hvor lenge tidslinjen bruker på å gli ett steg oppover. */
const SLIDE_MS = 600;

/** Teksten venter til raden nesten er ferdig med å åpne plassen sin, og toner
 *  så inn. Startet fadingen med en gang, dukket teksten opp mens den fortsatt
 *  var på vei og virket forhastet. */
const FADE_IN_DELAY_MS = 200;
const FADE_IN_MS = 380;

/** Tidslinjen mens turen løper. Samme markup og samme klasser som før — det
 *  er RADENE som animerer seg selv, og bevegelsen oppstår som en følge av det.
 *
 *  Et nytt steg åpner plassen sin ved å vokse fra null høyde, mens innholdet
 *  toner inn på sin endelige plass; steget som faller utenfor vinduet krymper
 *  til null mens det toner ut. Summen er konstant, så
 *  stabelen skyves rolig oppover uten at noe felles element flyttes. Tidligere
 *  ble hele lista forskjøvet under ett; da var fade og bevegelse to separate
 *  ting som måtte holdes i takt.
 *
 *  Animasjonene kjøres med Web Animations API, IKKE CSS-overganger: global.css
 *  setter `transition-duration: 0.01ms !important` når systemet står på
 *  «Reduser bevegelse», og det gjorde bevegelsen momentan. element.animate()
 *  går utenom transition-egenskapen og oppfører seg likt uansett innstilling.
 *
 *  Hver rad merkes i dataset når den er animert, så en ny render aldri kjører
 *  den samme inn- eller ut-animasjonen om igjen.
 *
 *  Kjøres i useLayoutEffect, FØR nettleseren maler. Med en vanlig effekt og to
 *  ventende frames rakk raden å bli malt i full høyde først, så den blinket
 *  fram, forsvant og tonet inn igjen. WAAPI trenger ingen malt starttilstand:
 *  animate() setter sin egen. */
function StepWindow({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    if (!rows.length) return;
    const ease = "cubic-bezier(0.22, 0.61, 0.36, 1)";

    // Nyeste steg: raden åpner plassen, innholdet toner inn der det ender.
    //
    // Raden klippes bevisst IKKE mens den vokser. Med overflow:hidden ble
    // teksten skåret av underkanten og så ut til å skli opp bak en kant; nå
    // står den i ro på sin endelige plass og bare dukker opp.
    const last = rows[rows.length - 1];
    if (!last.dataset.nvIn) {
      last.dataset.nvIn = "1";
      const h = last.offsetHeight;
      last.animate([{ height: "0px" }, { height: h + "px" }], {
        duration: SLIDE_MS,
        easing: ease,
      });
      const body = last.lastElementChild;
      if (body) {
        // Raden vokser nedenfra mens raden over krymper, så innholdet ville
        // ellers starte en radhøyde for lavt og gli opp gjennom underkanten.
        // Denne motsatte forskyvningen nuller den bevegelsen ut: teksten står
        // visuelt stille på sin endelige plass og toner bare inn.
        body.animate(
          [
            { transform: `translateY(${-h}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: SLIDE_MS, easing: ease },
        );
        body.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_IN_MS,
          delay: FADE_IN_DELAY_MS,
          easing: ease,
          fill: "backwards",
        });
      }
    }

    // Alt som havner utenfor vinduet krymper bort. fill holder dem nede.
    rows.slice(0, Math.max(0, rows.length - VISIBLE_STEPS)).forEach((row) => {
      if (row.dataset.nvOut) return;
      row.dataset.nvOut = "1";
      const h = row.offsetHeight;
      row.style.overflow = "hidden";
      row.animate(
        [
          { height: h + "px", opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: SLIDE_MS, easing: ease, fill: "forwards" },
      );
    });
  }, [count]);

  return (
    <div className={`${styles.timeline} ${styles.timelineLive}`} ref={listRef}>
      {children}
    </div>
  );
}

/** Én stegblokk i svaret. Åpen som tidslinje mens turen løper (arbeidet vokser
 *  nedover, så teksten over står i ro), sammenslått til «Arbeidet (n steg)»
 *  når svaret er ferdig. */
function StepsPart({
  steps,
  open,
  expanded,
  onToggle,
}: {
  steps: ChatStep[];
  open: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (open) {
    return (
      <StepWindow count={steps.length}>
        {/* Tidslinjen selv er URØRT — samme markup, samme klasser, samme
            avstander. Vinduet ligger utenpå. */}
        {steps.map((step, i) => (
          <div key={i}>
            {i > 0 && <span className={styles.stepLine} />}
            <div className={styles.step}>
              {/* Nyeste steg er det som pågår. Det markeres på IKONET, ikke på
                  teksten: skimmer over hele setningen ble for mye når det
                  ligger rett under «Tenker …» som allerede skimrer. */}
              <span
                className={
                  i === steps.length - 1
                    ? `${styles.stepIcon} ${styles.stepIconLive}`
                    : styles.stepIcon
                }
              >
                <StepIcon kind={step.kind} />
              </span>
              <span className={styles.reasoning}>{step.text}</span>
            </div>
          </div>
        ))}
      </StepWindow>
    );
  }
  return (
    <div className={styles.thoughtBox}>
      <button type="button" className={styles.thoughtToggle} onClick={onToggle}>
        {expanded ? "Skjul arbeidet" : `Arbeidet (${steps.length} steg)`}
      </button>
      {expanded && (
        <div className={styles.thoughtBody}>
          {steps.map((step, i) => (
            <div className={styles.step} key={i}>
              <span className={styles.stepIcon}>
                <StepIcon kind={step.kind} />
              </span>
              <span className={styles.reasoning}>{step.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hvor mange steg en tur får vise. Grundig modus kan kjøre 20 runder med
 *  flere steg hver, så taket må være romslig — det gamle på 10 kuttet
 *  tidslinjen midt i lange kjøringer. */
const MAX_STEPS = 60;

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
  /** Per segment: satt når segmentets fade-inn har spilt ferdig */
  revealedParts?: Record<number, boolean>;
  /** Faktisk modell backend valgte (fra streamen) */
  resolvedModel?: string;
  /** Kilder fra backendens websøk */
  sources?: SourceRef[];
  /** Svaret som kronologiske segmenter: tekst og arbeidssteg om hverandre */
  parts?: ChatPart[];
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
    cmd: "design",
    label: "Nytt design",
    desc: "Presentasjon, flyer eller kampanje",
    icon: BorderNone02Icon,
  },
];

// Kontekst-ring: fylles etter hvor mye av kontekstBUDSJETTET (det som faktisk
// sendes per tur) som er i bruk — ikke hele samtalen, den klippes uansett.
// Full ring = eldre historikk dekkes nå av samtalesammendraget.
function ContextRing({ messages }: { messages: { content: string }[] }) {
  // Klikk på ringen viser tokentallet ved siden av; nytt klikk skjuler det.
  const [showCount, setShowCount] = useState(false);
  const chars = messages
    .slice(-HISTORY_WINDOW)
    .reduce((n, m) => n + m.content.length, 0);
  const frac = Math.min(1, chars / HISTORY_CHAR_BUDGET);
  // Samme tommelfingerregel som resten av appen: ~3,5 tegn per token.
  const tokens = Math.round(chars / 3.5);
  const R = 6;
  const C = 2 * Math.PI * R;
  const warn = frac > 0.8;
  return (
    <button
      type="button"
      className={styles.ctxRing}
      onClick={() => setShowCount((v) => !v)}
      title={`~${Math.round(frac * 100)} % av kontekstbudsjettet brukt${frac >= 1 ? " — eldre historikk dekkes av sammendraget" : ""}`}
    >
      {showCount && (
        <span className={styles.ctxCount}>~{formatTokens(tokens)} tokens</span>
      )}
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          stroke={warn ? "#e6a23c" : "#949494"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform="rotate(-90 8 8)"
        />
      </svg>
    </button>
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
              <button
                key={u.id}
                className={styles.impRow}
                onClick={() => pick(u)}
              >
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
const ADMIN_ACTIONS: {
  cmd: string;
  label: string;
  desc: string;
  icon: typeof AnonymousIcon;
}[] = [
  {
    cmd: "forbruk",
    label: "Forbruk",
    desc: "Token- og kostnadsoversikt",
    icon: Analytics01Icon,
  },
  {
    cmd: "dokumenter",
    label: "Dokumenter",
    desc: "Dokumentbiblioteket",
    icon: Files01Icon,
  },
  {
    cmd: "ansatte",
    label: "Ansatte",
    desc: "Ansattregisteret",
    icon: UserGroupIcon,
  },
  {
    cmd: "enheter",
    label: "Enheter",
    desc: "Datterselskaper og avdelinger (kunnskaps-synlighet)",
    icon: UserGroupIcon,
  },
  {
    cmd: "deling",
    label: "Deling",
    desc: "Forespørsler om organisasjonsvid kunnskap",
    icon: UserGroupIcon,
  },
  {
    cmd: "tilganger",
    label: "Brukere og tilganger",
    desc: "Administrer brukere",
    icon: UserSettings01Icon,
  },
  {
    cmd: "tilkoblinger",
    label: "Tilkoblinger",
    desc: "Databaser og Microsoft 365",
    icon: Database01Icon,
  },
  {
    cmd: "koble",
    label: "Ny tilkobling",
    desc: "Koble til en ny datakilde",
    icon: Database01Icon,
  },
  {
    cmd: "graf",
    label: "Kunnskapsgraf",
    desc: "Grafen over bedriftskunnskapen",
    icon: ChartRelationshipIcon,
  },
  {
    cmd: "kvote",
    label: "Kvote",
    desc: "Token-kvoter per bruker",
    icon: DashboardSpeed01Icon,
  },
];

// Streamet tekst der hele ord fades inn i jevn takt, frikoblet fra
// nettverks-chunkenes rykkete ankomst. Ufullstendige ord holdes tilbake;
// markdown tar over når svaret er ferdig.
export function Chat({
  chatId,
  onStartAgent,
  onStartDesign,
  initialTitle,
  onChatCreated,
  onTitleGenerated,
  userRole,
}: {
  chatId: string | null;
  onStartAgent?: () => void;
  onStartDesign?: () => void;
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
    activityPresent ? [...messages, 0] : messages,
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
          {
            id: nextId(),
            role: "assistant",
            content: "Epost sendt :)",
            revealed: true,
          },
        ]);
        const cid = chatIdRef.current;
        if (cid)
          appendChatMessage(cid, {
            role: "assistant",
            content: "Epost sendt :)",
          }).catch(swallow);
      }),
    [],
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
            {
              id: nextId(),
              role: "user",
              content: text,
              display: text,
              revealed: true,
            },
            { id: nextId(), role: "assistant", content: reply, revealed: true },
          ]);
          const cid = chatIdRef.current;
          if (cid) {
            appendChatMessage(cid, { role: "user", content: text })
              .then(() =>
                appendChatMessage(cid, { role: "assistant", content: reply }),
              )
              .catch(swallow);
          }
          return;
        }
        send(text);
      }),
    // send er stabil nok her — lytteren registreres én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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
          })),
        ),
      )
      .catch(swallow);
  }, [chatId]);

  // Slå opp om chatten tilhører en agent (viser pause-knapp i topbaren).
  useEffect(() => {
    if (!chatId) {
      setAgent(null);
      return;
    }
    fetchChatAgent(chatId)
      .then(setAgent)
      .catch(() => setAgent(null));
  }, [chatId]);

  // Agent-chat: poll etter nye agent-meldinger mens chatten er åpen, så et
  // trigget resultat dukker opp uten at brukeren må forlate og gå tilbake.
  // Kun én lett henting hvert 15. sek, aldri under streaming.
  useEffect(() => {
    if (!chatId || !agent) return;
    const id = window.setInterval(
      () => {
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
            }),
          )
          .catch(swallow);
      },
      agent.mission ? 3000 : 15000,
    );
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
  const [trainOffer, setTrainOffer] = useState<{
    id: string;
    docs: Attachment[];
  } | null>(null);
  // Minnekortet: meldings-id-er brukeren har lagret til minnet denne økten.
  const [remembered, setRemembered] = useState<Set<string>>(new Set());
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
  // Hvilke ferdige svar som viser arbeidstidslinjen utfoldet (per melding-id).
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  // Satt etter «Hva skal vi koble til?» — neste melding intent-ruters
  // deterministisk (M365 rett til OAuth, databaser til agenten).
  const pendingConnectRef = useRef(false);
  const hasMessages = messages.length > 0;

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
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  // Ett tekstsegment har spilt ferdig fade-inn → bytt det til markdown. Egen
  // funksjon fordi streamen skriver `parts` på hver delta; revealedParts ligger
  // ved siden av og overlever.
  function revealPart(id: string, index: number) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, revealedParts: { ...m.revealedParts, [index]: true } }
          : m,
      ),
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
  // Brukerens org-posisjon: styrer synlighetsvalget på tren-tilbudet
  // («kun min enhet» vises bare når enheten finnes).
  const [myOrg, setMyOrg] = useState<OrgMe | null>(null);
  useEffect(() => {
    orgMe().then(setMyOrg).catch(() => setMyOrg(null));
  }, []);
  // Etter Ja på tren-tilbudet: brukeren velger hvem kunnskapen gjelder for
  // (Jacobs modul-design 2026-08-01) — valget er selve tilgangsstyringen.
  const [trainChoosing, setTrainChoosing] = useState(false);

  async function acceptTrain(scope: string = "") {
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
          saveDocument({
            filename: d.name,
            text: d.text,
            chat_id: chatIdRef.current ?? undefined,
            scope,
          }),
        ),
      );
      const titles = saved.map((s) => `«${s.title}»`).join(", ");
      const content = `Lagret ${titles} i kunnskapsbasen. Jeg bruker det automatisk framover.`;
      update(replyId, { loading: false, content, revealed: true });
      const cid = chatIdRef.current;
      if (cid)
        appendChatMessage(cid, { role: "assistant", content }).catch(swallow);
    } catch (e) {
      update(replyId, {
        loading: false,
        error: true,
        content:
          "Kunne ikke lagre: " +
          (e instanceof Error ? e.message : "ukjent feil"),
      });
    }
  }

  // Minnekortet: lagre meldingen som bedriftskunnskap med ett klikk.
  function rememberMsg(id: string, content: string) {
    setRemembered((prev) => new Set(prev).add(id));
    rememberMessage({
      text: content,
      chat_id: chatIdRef.current ?? undefined,
    }).catch(() => {
      setRemembered((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
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
          saveDocument({
            filename: d.name,
            text: d.text,
            chat_id: chatIdRef.current ?? undefined,
            // Inline-lagring («lagre denne») spør ikke: scope arves
            // (enheten din når du har en, ellers hele firmaet).
            scope: "",
          }),
        ),
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
        content:
          "Kunne ikke lagre dokumentet: " +
          (e instanceof Error ? e.message : "ukjent feil"),
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
      {
        id: nextId(),
        role: "user",
        content: raw,
        display: raw,
        revealed: true,
      },
      { id: nextId(), role: "assistant", content: block, revealed: true },
    ]);
    const cid = chatIdRef.current;
    if (cid) {
      appendChatMessage(cid, { role: "user", content: raw })
        .then(() =>
          appendChatMessage(cid, { role: "assistant", content: block }),
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
      {
        id: nextId(),
        role: "user",
        content: raw,
        display: raw,
        revealed: true,
      },
      { id: nextId(), role: "assistant", content: block, revealed: true },
    ]);
    const cid = chatIdRef.current;
    if (cid) {
      appendChatMessage(cid, { role: "user", content: raw })
        .then(() =>
          appendChatMessage(cid, { role: "assistant", content: block }),
        )
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
          {
            id: userId,
            role: "user",
            content: raw,
            display: raw,
            revealed: true,
          },
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
              content:
                "Logg inn i Microsoft-vinduet (knappen over feltet hvis det ikke åpnet seg) — jeg sier fra når koblingen er bekreftet.",
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
                  {
                    id: nextId(),
                    role: "assistant",
                    content: `Microsoft 365 er koblet til som ${st2.email} ✓`,
                    revealed: true,
                  },
                ]);
              }
            }, 2000);
            window.setTimeout(() => window.clearInterval(t), 180000);
          }
        } catch {
          update(replyId, {
            loading: false,
            error: true,
            content: "Kunne ikke starte Microsoft-innloggingen.",
          });
        }
        return;
      }
      // Ikke M365: spawn credential-skjemaet direkte — svaret re-rutes ALDRI
      // via intent-motoren (feilstavinger som «datbase» droppet hele flyten).
      setInput("");
      const drv = /mysql/i.test(raw)
        ? "mysql"
        : /mssql|sql ?server/i.test(raw)
          ? "mssql"
          : "postgres";
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          content: raw,
          display: raw,
          revealed: true,
        },
        {
          id: nextId(),
          role: "assistant",
          content:
            "Fyll inn tilkoblingen her — passordet går kryptert utenom chatten. Lurer du på noe underveis, bare spør.\n```credential\n" +
            JSON.stringify({ driver: drv }) +
            "\n```",
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
      emit("compose-send", {
        text: "Opprett en ny kobling",
        reply: "Hva skal vi koble til?",
        intent: "connect",
      });
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

    // /design åpner designsiden med galleriet. Lerretet er en egen side, ikke
    // et panel oppå samtalen — se DesignWorkspace.
    if (/^\/design\b/i.test(raw)) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onStartDesign?.();
      return;
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
    const buildingWidget =
      (isWidgetCmd || widgetPendingRef.current) && !!widgetDesc;
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
          ...images.map((a): ContentPart => ({
            type: "image_url",
            image_url: { url: a.image! },
          })),
        ]
      : textContent;

    const built = buildHistory(messages, { role: "user", content: apiContent });
    const history = built.history;
    const historyClipped = built.clipped;

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
        ? {
            id: replyId,
            role: "assistant",
            content: widgetBlock,
            revealed: true,
          }
        : { id: replyId, role: "assistant", content: "", loading: true },
    ]);

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
        content:
          "Backend er ikke konfigurert. Sett VITE_API_BASE_URL (og evt. VITE_API_KEY) i .env.local.",
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
      // Segmentene bygges i den rekkefølgen deltaene kommer: tekst appender til
      // siste tekstsegment, et steg til siste stegblokk — og bytter delta-type,
      // åpnes et nytt segment. Slik havner arbeidet alltid under teksten det
      // kom etter. `stepCount`/`lastStep` er kun tak og duplikatvern.
      const parts: ChatPart[] = [];
      let stepCount = 0;
      let lastStep = "";
      const pushText = (text: string) => {
        const last = parts[parts.length - 1];
        if (last?.kind === "text") last.text += text;
        else parts.push({ kind: "text", text });
      };
      const pushStep = (label: string, kind?: string) => {
        if (!label || label === lastStep || stepCount >= MAX_STEPS) return;
        lastStep = label;
        stepCount++;
        const last = parts[parts.length - 1];
        if (last?.kind === "steps") last.steps.push({ text: label, kind });
        else parts.push({ kind: "steps", steps: [{ text: label, kind }] });
      };
      // Ny referanse på hvert segment, ellers ser React ingen endring.
      const snapshot = (): ChatPart[] =>
        parts.map((p) =>
          p.kind === "text" ? { ...p } : { kind: "steps", steps: [...p.steps] },
        );
      await streamChat(
        "auto",
        history,
        (delta) => {
          if (delta.reasoning) think += delta.reasoning;
          if (delta.step) pushStep(delta.step, delta.stepKind);
          if (delta.query) tableQuery = delta.query;
          if (delta.content) {
            acc += delta.content;
            pushText(delta.content);
          }
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
          if (presetWidget) return;
          update(replyId, {
            loading: !acc && !think && stepCount === 0,
            content: acc,
            reasoning: think,
            streaming: true,
            resolvedModel: resolved,
            sources: [...sources],
            parts: snapshot(),
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
          // Sammendrags-kontrakten: backend injiserer samtalesammendraget
          // når historikken er klippet mot tegnbudsjettet.
          chatId: chatIdRef.current ?? undefined,
          clipped: historyClipped,
        },
      );
      // Widget-tur: vis widgeten kun når specen faktisk ble endret denne turen.
      // Ren prat («Takk») får modellens tekstsvar i stedet for en ny widget.
      if (widgetTurnSlug) {
        if (presetWidget || widgetTouched) {
          acc = widgetBlock;
          // Widgeten erstatter svaret: kast segmentene fra turen med.
          update(replyId, {
            loading: false,
            streaming: false,
            content: widgetBlock,
            parts: undefined,
            revealed: true,
          });
        } else {
          if (!acc) {
            acc = "Ok.";
            pushText(acc);
          }
          update(replyId, {
            loading: false,
            streaming: false,
            content: acc,
            parts: snapshot(),
          });
        }
        reloadWidgets();
      } else {
        update(replyId, { streaming: false });
        if (!acc) {
          pushText("(tomt svar)");
          update(replyId, {
            loading: false,
            content: "(tomt svar)",
            parts: snapshot(),
          });
        }
      }

      // Agenten kan ha endret seg selv via chatten — synk state + sidepanel.
      if (agent && chatIdRef.current) {
        fetchChatAgent(chatIdRef.current).then(setAgent).catch(swallow);
        emit("agents-changed");
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
            }),
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
      if (e instanceof DOMException && e.name === "AbortError") {
        // Trukket tilbake: turen fjernes fra chatten og teksten legges
        // tilbake i feltet — avbrudd skjer oftest for å rette en skrivefeil.
        // Ingenting er persistert ennå (lagringen skjer først etter fullført
        // stream), så det holder å rydde lokalt. Har brukeren alt begynt å
        // skrive noe nytt, lar vi det stå.
        setMessages((prev) =>
          prev.filter((m) => m.id !== userMsgId && m.id !== replyId),
        );
        setInput((cur) => (cur.trim() ? cur : text));
        if (files.length) setAttachments((cur) => (cur.length ? cur : files));
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
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
  // @-nevninger: en snarvei til hjernen, ikke en forutsetning. Automatisk
  // gjenkjenning gjelder fortsatt — dette gir bare et entydig treff når
  // brukeren VET hvem hun mener.
  const mentionMatch = /(?:^|\s)@([\p{L}0-9.-]*)$/u.exec(input);
  const mentionQuery = mentionMatch?.[1] ?? "";
  const mentioning = mentionMatch !== null;

  const slashMatch = /^\/([a-z0-9-]*)$/i.exec(input);
  const slashPrefix = slashMatch?.[1].toLowerCase() ?? "";
  const slashItems = slashMatch
    ? [
        ...SLASH_ACTIONS.filter((a) => a.cmd.startsWith(slashPrefix)),
        // Hele admin-styringen er kun for admin (og skjules under simulering).
        ...(effectiveRole === "admin"
          ? ADMIN_ACTIONS.filter((a) => a.cmd.startsWith(slashPrefix)).map(
              (a) => ({ ...a, tag: "Admin" }),
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

  const [mentions, setMentions] = useState<BrainEntity[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  useEffect(() => {
    if (!mentioning) {
      setMentions([]);
      return;
    }
    let alive = true;
    searchEntities(mentionQuery)
      .then((e) => alive && setMentions(e))
      .catch(() => alive && setMentions([]));
    return () => {
      alive = false;
    };
  }, [mentioning, mentionQuery]);
  useEffect(() => setMentionIndex(0), [mentionQuery]);
  const mentionOpen = mentions.length > 0;

  // Sett inn navnet der @-et står, så teksten blir lesbar for både modell og
  // menneske.
  function pickMention(name: string) {
    setInput((v) => v.replace(/@[\p{L}0-9.-]*$/u, "@" + name + " "));
    setMentions([]);
    textareaRef.current?.focus();
  }

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
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentions.length) % mentions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentions[mentionIndex]?.name ?? mentions[0].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentions([]);
        return;
      }
    }
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
                  onClick={() =>
                    setAttachments((prev) => prev.filter((x) => x !== a))
                  }
                  aria-label={`Fjern ${a.name}`}
                >
                  ×
                </button>
              </span>
            ) : (
              <FileTag
                key={a.name}
                name={a.name}
                onRemove={() =>
                  setAttachments((prev) => prev.filter((x) => x !== a))
                }
              />
            ),
          )}
          {uploadError && (
            <span className={styles.attachError}>{uploadError}</span>
          )}
        </div>
      )}
      <Composer
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Spør om hva som helst …"
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onFiles={handleFiles}
        slashItems={slashOpen ? slashItems : undefined}
        slashIndex={slashIndex}
        onSlashHover={setSlashIndex}
        onSlashPick={pickSlash}
        mentions={mentionOpen ? mentions : undefined}
        mentionIndex={mentionIndex}
        onMentionHover={setMentionIndex}
        onMentionPick={pickMention}
        model={modelAlias(activeModel)}
        modelHint={modelDesc(activeModel)}
        left={userRole === "admin" ? <ImpersonatePill /> : null}
        right={<ContextRing messages={messages} />}
        onStop={busy ? () => abortRef.current?.abort() : undefined}
      />
    </>
  );

  return (
    <AgentChatContext.Provider value={agent?.id ?? null}>
      <div className={styles.chatRoot}>
        {trainChoosing && trainOffer && (
          <div className={styles.scopeOverlay} onClick={() => setTrainChoosing(false)}>
            <div className={styles.scopeCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.scopeTitle}>Dette gjør agenten bedre.</div>
              <div className={styles.scopeText}>
                Skal kunnskapen gjelde bare for deg, eller for flere?
              </div>
              <div className={styles.scopeBtns}>
                <button
                  type="button"
                  className={styles.scopeBtn}
                  onClick={() => {
                    setTrainChoosing(false);
                    acceptTrain("private");
                  }}
                >
                  Bare meg
                  <span className={styles.scopeBtnHint}>Kun i dine egne samtaler</span>
                </button>
                {(myOrg?.units ?? []).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={styles.scopeBtn}
                    onClick={() => {
                      setTrainChoosing(false);
                      acceptTrain(`unit:${u.id}`);
                    }}
                  >
                    {u.name}
                    <span className={styles.scopeBtnHint}>Alle i {u.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.scopeBtn}
                  onClick={() => {
                    setTrainChoosing(false);
                    acceptTrain("tenant");
                  }}
                >
                  Hele organisasjonen
                  <span className={styles.scopeBtnHint}>Alle i bedriften</span>
                </button>
              </div>
              <button
                type="button"
                className={styles.scopeCancel}
                onClick={() => setTrainChoosing(false)}
              >
                Avbryt
              </button>
            </div>
          </div>
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
            <HugeiconsIcon
              icon={LayoutAlignLeftIcon}
              size={17}
              strokeWidth={2}
            />
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
                  title={
                    agent.enabled
                      ? "Sett agenten på pause"
                      : "Gjenoppta agenten"
                  }
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
                        <rect
                          x="7"
                          y="6"
                          width="2"
                          height="8"
                          rx="1"
                          fill="white"
                        />
                        <rect
                          x="11"
                          y="6"
                          width="2"
                          height="8"
                          rx="1"
                          fill="white"
                        />
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
                  aria-label={
                    agent.push_enabled ? "Skru av push" : "Skru på push"
                  }
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
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
                  title={
                    showFlow
                      ? "Tilbake til chatten"
                      : "Se og rediger agentens flyt"
                  }
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
                  <HugeiconsIcon
                    icon={Delete01Icon}
                    size={16}
                    strokeWidth={2}
                  />
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
                        {m.role === "assistant" && !m.error ? (
                          (() => {
                            // Segmentene rendres i den rekkefølgen de kom: tekst,
                            // så arbeidet som fulgte, så neste tekst. Den aktive
                            // linjen står nederst i siste stegblokk og KUTTES i det
                            // modellen begynner å skrive — da er tekst siste
                            // segment, og arbeidet gjenopptas under den.
                            const parts = partsOf(m);
                            const working = !!(m.streaming || m.loading);
                            // Handlingsraden venter til siste tekstsegment har
                            // animert ferdig, ellers dukker den opp under en
                            // tekst som fortsatt vokser.
                            const lastText = parts.reduce(
                              (acc, p, i) => (p.kind === "text" ? i : acc),
                              -1,
                            );
                            const settled =
                              !working &&
                              (lastText < 0 ||
                                !!m.revealed ||
                                !!m.revealedParts?.[lastText]);
                            return (
                              <>
                                {/* Unntaket fra kronologien: «Tenker …» står fast
                                øverst så lenge turen løper — den flytter seg
                                aldri, arbeidet og teksten flyter under den. */}
                                {working && (
                                  <ActiveStep
                                    label={thinkingLabel(m.reasoning)}
                                    glow={modelGlow(m.resolvedModel ?? null)}
                                  />
                                )}
                                {parts.map((p, i) => {
                                  if (p.kind === "steps") {
                                    return (
                                      <StepsPart
                                        key={i}
                                        steps={p.steps}
                                        open={working}
                                        expanded={!!openSteps[`${m.id}:${i}`]}
                                        onToggle={() =>
                                          setOpenSteps((prev) => ({
                                            ...prev,
                                            [`${m.id}:${i}`]:
                                              !prev[`${m.id}:${i}`],
                                          }))
                                        }
                                      />
                                    );
                                  }
                                  const revealed =
                                    m.revealed || m.revealedParts?.[i];
                                  if (!revealed) {
                                    return (
                                      <StreamingText
                                        key={i}
                                        // Samme formatering som markdown-visningen
                                        // får: avsnittene og uthevingen er på plass
                                        // allerede under animasjonen, så byttet
                                        // etterpå ikke flytter en linje.
                                        content={formatAnswer(
                                          normalizeFences(p.text),
                                        )}
                                        done={
                                          !m.streaming || i < parts.length - 1
                                        }
                                        onDone={() => revealPart(m.id, i)}
                                      />
                                    );
                                  }
                                  const ts =
                                    i === 0 &&
                                    agent &&
                                    p.text.match(
                                      /^\*\*(.+?)\*\*\n\n([\s\S]*)$/,
                                    );
                                  const formatted = formatAnswer(
                                    normalizeFences(ts ? ts[2] : p.text),
                                  );
                                  // Én markering per svar, i det SISTE
                                  // tekstsegmentet: mellomtekstene motoren skriver
                                  // mens den jobber er ikke konklusjonen — den
                                  // kommer til slutt.
                                  const shown =
                                    i === lastText
                                      ? markKeySentence(formatted)
                                      : formatted;
                                  return (
                                    <div className={styles.markdown} key={i}>
                                      {ts && (
                                        <div className={styles.agentStamp}>
                                          {ts[1]}
                                        </div>
                                      )}
                                      <Markdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          a: SourceLink,
                                          pre: MarkdownPre,
                                        }}
                                      >
                                        {shown}
                                      </Markdown>
                                    </div>
                                  );
                                })}
                                {settled && m.content && (
                                  <MessageActions
                                    content={m.content}
                                    sources={m.sources}
                                    armed={correctionTarget?.id === m.id}
                                    onArm={(content) =>
                                      setCorrectionTarget((cur) =>
                                        cur?.id === m.id
                                          ? null
                                          : { id: m.id, content },
                                      )
                                    }
                                    remembered={remembered.has(m.id)}
                                    onRemember={(content) =>
                                      rememberMsg(m.id, content)
                                    }
                                  />
                                )}
                              </>
                            );
                          })()
                        ) : m.content ? (
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
                                      className={styles.attachTag}
                                    >
                                      <span
                                        className={styles.attachTagIconBox}
                                        style={{
                                          background: fileTagColor(name)[0],
                                          color: fileTagColor(name)[1],
                                        }}
                                      >
                                        <HugeiconsIcon
                                          icon={fileIcon(name)}
                                          size={14}
                                          strokeWidth={2}
                                        />
                                      </span>
                                      <span className={styles.attachTagName}>
                                        {name}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              )}
                          </>
                        ) : null}
                      </TableQueryContext.Provider>
                    </div>
                    {m.role === "user" && !m.loading && (
                      <div className={styles.userActions}>
                        <button
                          className={`${styles.actionBtn} ${remembered.has(m.id) ? styles.actionBtnActive : ""}`}
                          onClick={() =>
                            !remembered.has(m.id) &&
                            rememberMsg(m.id, m.content)
                          }
                          title={
                            remembered.has(m.id)
                              ? "Lagret i minnet"
                              : "Lagre til minnet"
                          }
                          aria-label="Lagre til minnet"
                        >
                          <HugeiconsIcon
                            icon={SdCardIcon}
                            size={15}
                            strokeWidth={2}
                          />
                        </button>
                      </div>
                    )}
                    {trainOffer?.id === m.id && (
                      <div className={styles.trainOffer}>
                        <span className={styles.trainOfferText}>
                          Tren modellen på dette?
                        </span>
                        <button
                          type="button"
                          className={styles.trainYes}
                          onClick={() => setTrainChoosing(true)}
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
                        <span
                          className={`${styles.stepActive} ${styles.activityThought} ${styles.textShimmer}`}
                        >
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
                            <span
                              className={`${styles.reasoning} ${styles.activityStep}`}
                            >
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
