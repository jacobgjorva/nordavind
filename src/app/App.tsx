import { useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";
import { Login } from "../features/auth/Login";
import { Settings } from "../features/settings/Settings";
import { Sidebar } from "../layout/Sidebar";
import {
  clearToken,
  createDraftAgent,
  deleteChat,
  fetchChats,
  fetchMe,
  getToken,
  type AuthUser,
  type ChatSummary,
} from "../lib/api";
import { on } from "../lib/events";
import { swallow } from "../lib/log";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");
  // session styrer remount av Chat; activeChatId er kun sidebar-markering.
  // De er adskilt slik at opprettelse av samtale midt i en stream ikke
  // remonter komponenten og dreper streamen.
  const [session, setSession] = useState<{
    key: number;
    chatId: string | null;
    kind?: string;
  }>({ key: 0, chatId: null });
  const [chats, setChats] = useState<ChatSummary[]>([]);
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
    }
  }, [user]);

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
    <div className={styles.app}>
      <Sidebar
        chats={chats}
        activeChatId={view === "chat" ? activeChatId : null}
        userEmail={user.email}
        onNewChat={newChat}
        onOpenSettings={openSettings}
        onOpenChat={openChat}
        onDeleteChat={onDeleteChat}
        onLogout={logout}
      />
      <div className={styles.main}>
        <Chat
          key={session.key}
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
  );
}
