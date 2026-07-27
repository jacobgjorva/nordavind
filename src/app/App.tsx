import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";

// Agent-grafen lazy-lastes så den ikke belaster chat-bundelen.
const Hub = lazy(() => import("../features/hub/Hub"));
// Designsiden lastes først når noen faktisk lager noe — den drar med seg
// hele rendreren og grafprimitivene.
const DesignWorkspace = lazy(() =>
  import("../features/design/DesignWorkspace").then((m) => ({
    default: m.DesignWorkspace,
  }))
);
import { Login } from "../features/auth/Login";
import { M365Onboarding } from "../features/auth/M365Onboarding";
import { Settings } from "../features/settings/Settings";
import { KnowledgeGraph } from "../features/settings/KnowledgeGraph";
import { Sidebar } from "../layout/Sidebar";
import { AdminUserContext } from "../tools/admin";
import {
  clearToken,
  createDesign,
  createDraftAgent,
  createFolder,
  deleteChat,
  deleteFolder,
  fetchChats,
  fetchFolders,
  fetchMe,
  getToken,
  renameFolder,
  setChatFolder,
  type AuthUser,
  type ChatSummary,
  type Folder,
} from "../lib/api";
import { on } from "../lib/events";
import { swallow } from "../lib/log";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState<"chat" | "settings" | "hub" | "graph" | "design">("chat");
  // Åpent designdokument (slug). Design er en egen side, ikke et lag over
  // chatten — se DesignWorkspace.
  const [designSlug, setDesignSlug] = useState<string | null>(null);
  // session styrer remount av Chat; activeChatId er kun sidebar-markering.
  // De er adskilt slik at opprettelse av samtale midt i en stream ikke
  // remonter komponenten og dreper streamen.
  const [session, setSession] = useState<{
    key: number;
    chatId: string | null;
    kind?: string;
  }>({ key: 0, chatId: null });
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // null = ukjent (validerer token), false = ikke innlogget
  const [user, setUser] = useState<AuthUser | null | false>(
    getToken() ? null : false
  );

  useEffect(() => {
    if (user !== null) return;
    fetchMe()
      .then((me) => setUser(me.user))
      .catch(() => {
        clearToken();
        setUser(false);
      });
  }, [user]);

  useEffect(() => {
    if (user && user !== null) {
      fetchChats().then(setChats).catch(swallow);
      fetchFolders().then(setFolders).catch(swallow);
    }
  }, [user]);

  const refreshFolders = useCallback(
    () => fetchFolders().then(setFolders).catch(swallow),
    []
  );

  const newFolder = useCallback(async () => {
    try {
      await createFolder("Ny mappe");
      await refreshFolders();
    } catch {
      /* ikke kritisk */
    }
  }, [refreshFolders]);

  const onRenameFolder = useCallback(
    async (id: string, name: string) => {
      setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
      try {
        await renameFolder(id, name);
      } catch {
        refreshFolders();
      }
    },
    [refreshFolders]
  );

  const onDeleteFolder = useCallback(
    async (id: string) => {
      try {
        await deleteFolder(id);
      } catch {
        /* ikke kritisk */
      }
      await refreshFolders();
      fetchChats().then(setChats).catch(swallow);
    },
    [refreshFolders]
  );

  const onMoveChatToFolder = useCallback(
    async (chatId: string, folderId: string) => {
      setChats((cs) =>
        cs.map((c) => (c.id === chatId ? { ...c, folder_id: folderId } : c))
      );
      try {
        await setChatFolder(chatId, folderId);
      } catch {
        fetchChats().then(setChats).catch(swallow);
      }
    },
    []
  );

  // Agent-widgeten varsler når en agent opprettes/slettes → oppdater listen.
  useEffect(() => on("agents-changed", () => fetchChats().then(setChats).catch(swallow)), []);

  // Sletting av en agent-chat: naviger bort hvis den er åpen.
  useEffect(
    () =>
      on("chat-deleted", (id) => {
        fetchChats().then(setChats).catch(swallow);
        if (id && id === activeChatId) newChat();
      }),
    [activeChatId]
  );

  const newChat = useCallback(() => {
    setActiveChatId(null);
    setSession((s) => ({ key: s.key + 1, chatId: null }));
    setView("chat");
  }, []);

  // Chat-headeren ber om ny chat.
  useEffect(() => on("new-chat", newChat), [newChat]);

  const openChat = useCallback(
    (id: string, kind?: string) => {
      const chat = chats.find((c) => c.id === id);
      // Design-chatter åpner lerretet sitt, ikke en samtaletråd.
      if ((kind ?? chat?.kind) === "design" && chat?.design_slug) {
        setActiveChatId(id);
        setDesignSlug(chat.design_slug);
        setView("design");
        return;
      }
      setActiveChatId(id);
      setSession((s) => ({
        key: s.key + 1,
        chatId: id,
        kind: kind ?? chats.find((c) => c.id === id)?.kind,
      }));
      setView("chat");
    },
    [chats]
  );

  const onChatCreated = useCallback((chat: ChatSummary) => {
    setActiveChatId(chat.id);
    fetchChats().then(setChats).catch(swallow);
  }, []);

  // /agent oppretter en fersk, deaktivert agent-chat og lander brukeren i den.
  // Ingen AI: bare en ekte agent-tråd (vises i «Agenter»-gruppa) å konfigurere.
  const startAgent = useCallback(async () => {
    try {
      const agent = await createDraftAgent();
      const list = await fetchChats();
      setChats(list);
      setActiveChatId(agent.chat_id);
      setSession((s) => ({ key: s.key + 1, chatId: agent.chat_id }));
      setView("chat");
    } catch {
      // Ikke kritisk; brukeren kan prøve igjen.
    }
  }, []);

  // /design oppretter et tomt dokument og en chat som eier det, og lander
  // brukeren på designsiden med galleriet som første skjerm.
  const startDesign = useCallback(async (kit?: string) => {
    try {
      const d = await createDesign(kit ?? "", "");
      const list = await fetchChats();
      setChats(list);
      setActiveChatId(d.chat_id);
      setDesignSlug(d.slug);
      setView("design");
    } catch {
      // Ikke kritisk; brukeren kan prøve igjen.
    }
  }, []);

  const onDeleteChat = useCallback(
    async (id: string) => {
      try {
        await deleteChat(id);
      } catch {
        // Ikke kritisk
      }
      const list = await fetchChats().catch(() => null);
      if (list) setChats(list);
      if (id === activeChatId) newChat();
    },
    [activeChatId, newChat]
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(false);
  }, []);

  const openSettings = useCallback(() => setView("settings"), []);
  const closeSettings = useCallback(() => setView("chat"), []);
  // /agents er en egen side med egen URL — åpne/lukk synces mot historikken,
  // og en direkte lastet /agents lander rett i grafen.
  const openHub = useCallback(() => {
    setView("hub");
    if (window.location.pathname !== "/agents") {
      window.history.pushState({}, "", "/agents");
    }
  }, []);
  const closeHub = useCallback(() => {
    setView("chat");
    if (window.location.pathname === "/agents") {
      window.history.pushState({}, "", "/");
    }
  }, []);
  // /graf er kunnskapsgrafens egen side, samme mønster som /agents.
  const openGraph = useCallback(() => {
    setView("graph");
    if (window.location.pathname !== "/graf") {
      window.history.pushState({}, "", "/graf");
    }
  }, []);
  useEffect(() => {
    const fromPath = () =>
      window.location.pathname === "/agents"
        ? "hub"
        : window.location.pathname === "/graf"
          ? "graph"
          : "chat";
    setView((v) => (fromPath() === "chat" ? v : fromPath()));
    const onPop = () => setView(fromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Esc lukker settings-overlayet.
  useEffect(() => {
    if (view !== "settings") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView("chat");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  if (user === null) return null; // validerer sesjon
  if (user === false) return <Login onLogin={setUser} />;

  return (
    <AdminUserContext.Provider value={user.id}>
    <div className={styles.app}>
      <M365Onboarding userId={user.id} />
      <Sidebar
        chats={chats}
        activeChatId={view === "chat" ? activeChatId : null}
        userEmail={user.email}
        onNewChat={newChat}
        onOpenSettings={openSettings}
        onOpenHub={openHub}
        onOpenGraph={openGraph}
        onNewDesign={() => startDesign()}
        onOpenChat={openChat}
        onDeleteChat={onDeleteChat}
        folders={folders}
        onNewFolder={newFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        onMoveChatToFolder={onMoveChatToFolder}
        onLogout={logout}
      />
      {/* AdminUserContext: admin-panelene i chatten trenger innlogget bruker-id. */}
      <div className={styles.main}>
        {/* Chatten forblir montert (skjult) når grafen vises — en pågående
            stream skal ikke dø av navigasjon. Sidebaren er global. */}
        <div
          className={
            view === "hub" || view === "graph" || view === "design"
              ? styles.chatWrapHidden
              : styles.chatWrap
          }
        >
          <Chat
            key={session.key}
            userRole={user.role}
            chatId={session.chatId}
            onStartAgent={startAgent}
            onStartDesign={startDesign}
            initialTitle={
              session.chatId
                ? chats.find((c) => c.id === session.chatId)?.title ?? null
                : null
            }
            onChatCreated={onChatCreated}
            onTitleGenerated={() => {
              fetchChats().then(setChats).catch(swallow);
            }}
          />
        </div>
        {view === "hub" && (
          <Suspense fallback={null}>
            <Hub onClose={closeHub} onOpenChat={openChat} />
          </Suspense>
        )}
        {view === "design" && designSlug && (
          <div className={styles.designPage}>
            <Suspense fallback={null}>
              <DesignWorkspace key={designSlug} slug={designSlug} />
            </Suspense>
          </div>
        )}
        {view === "graph" && (
          <div className={styles.graphPage}>
            <KnowledgeGraph fill />
          </div>
        )}
      </div>
      {view === "settings" && (
        <div className={styles.settingsOverlay} onClick={closeSettings}>
          <div
            className={styles.settingsModal}
            onClick={(e) => e.stopPropagation()}
          >
            <Settings user={user} onClose={closeSettings} />
          </div>
        </div>
      )}
    </div>
    </AdminUserContext.Provider>
  );
}
