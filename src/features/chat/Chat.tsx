import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentChatContext } from "../../tools/agent/MissionPlan";
import { Logo } from "../../ui/Logo";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AnonymousIcon,
  BorderNone02Icon,
  Delete01Icon,
  Csv01Icon,
  Doc01Icon,
  HtmlFile01Icon,
  LottiefilesIcon,
  Pdf01Icon,
  Svg01Icon,
  Txt01Icon,
  Xls01Icon,
  Zip01Icon,
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
import { modelAlias, modelDesc, modelGlow } from "../../lib/models";
import { emit } from "../../lib/events";
import { swallow } from "../../lib/log";
import { formatTokens, nextId, isWidgetOnly, slugify, buildHistory, wantsAgentEdit, wantsSaveDocument } from "./chatHelpers";
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
}: {
  chatId: string | null;
  onStartAgent?: () => void;
  initialTitle?: string | null;
  onChatCreated?: (chat: ChatSummary) => void;
  onTitleGenerated?: () => void;
}) {
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
  const [activeModel, setActiveModel] = useState<string | null>(
    "qwen3-235b-a22b-instruct-2507"
  );
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

    const history = buildHistory(messages, { role: "user", content: apiContent });

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
          // Draft-agent (ikke godkjent ennå): kjør alltid oppdrags-planlegging.
          // Ferdig agent: kun når meldingen faktisk ber om en endring.
          agentEdit:
            agent?.id && (!agent.criteria_approved || wantsAgentEdit(text))
              ? agent.id
              : undefined,
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
        fetchChatAgent(chatIdRef.current).then(setAgent).catch(swallow);
        emit("agents-changed");
      }

      // Passivt kunnskaps-uttrekk fra utvekslingen (ikke agent/widget-bygging).
      // Hopp over korte meldinger uten substans; backend gater videre på
      // bedriftsinterne markører før den bruker et LLM-kall.
      if (acc && text.trim().length >= 40 && !agentModeRef.current && !widgetEditRef.current) {
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
      {/* Vedlegg som tags OVER composeren — fil-ikon + navn + fjern. */}
      {(attachments.length > 0 || uploadError) && (
        <div className={styles.attachTagRow}>
          {attachments.map((a) => (
            <span key={a.name} className={styles.attachTag}>
              {a.image ? (
                <img src={a.image} alt="" className={styles.attachTagIcon} />
              ) : (
                <span
                  className={styles.attachTagIconBox}
                  style={{
                    background: fileTagColor(a.name)[0],
                    color: fileTagColor(a.name)[1],
                  }}
                >
                  <HugeiconsIcon icon={fileIcon(a.name)} size={14} strokeWidth={2} />
                </span>
              )}
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
          ))}
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
          accept=".pdf,.docx,.txt,.md,.csv,.json,.log,text/*,image/*"
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
        <span className={styles.cmdHint}>
          Kommandoer <span className={styles.kbd}>/</span>
        </span>
        <span className={styles.sendHint}>
          Send <span className={styles.kbd}>↵</span>
        </span>
      </div>
    </div>
    </>
  );

  return (
    <AgentChatContext.Provider value={agent?.id ?? null}>
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
                    } ${isWidgetOnly(m.content) ? styles.widgetBubble : ""} ${
                      trainOffer?.id === m.id ? styles.bubbleOffer : ""
                    }`}
                  >
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
                      <span className={`${styles.stepActive} ${styles.activityThought}`}>
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
