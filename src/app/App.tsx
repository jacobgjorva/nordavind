import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";

// Farmen lazy-lastes: three.js (~150 kB gzip) skal aldri belaste chat-bundelen.
const Farm = lazy(() => import("../features/farm/Farm"));
import { Login } from "../features/auth/Login";
import { M365Onboarding } from "../features/auth/M365Onboarding";
import { Settings } from "../features/settings/Settings";
import { Sidebar } from "../layout/Sidebar";
import { AdminUserContext } from "../tools/admin";
import {
  clearToken,
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
  const [view, setView] = useState<"chat" | "settings" | "farm">("chat");
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
  const openFarm = useCallback(() => setView("farm"), []);
  const closeFarm = useCallback(() => setView("chat"), []);

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
        onOpenFarm={openFarm}
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
        <Chat
          key={session.key}
          userRole={user.role}
          chatId={session.chatId}
          onStartAgent={startAgent}
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
      {view === "farm" && (
        <Suspense fallback={null}>
          {/* Overlay, ikke bytte av hovedvisning: en pågående chat-stream
              under skal ikke dø av en tur i skogen. */}
          <Farm onClose={closeFarm} onOpenChat={openChat} />
        </Suspense>
      )}
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
