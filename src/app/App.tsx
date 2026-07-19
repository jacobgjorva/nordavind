import { useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";
import { Mail } from "../features/mail/Mail";
import { Login } from "../features/auth/Login";
import { Settings } from "../features/settings/Settings";
import { Sidebar } from "../layout/Sidebar";
import {
  clearToken,
  fetchChats,
  fetchMe,
  getToken,
  type AuthUser,
  type ChatSummary,
} from "../lib/api";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState<"chat" | "settings" | "mail">("chat");
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
      fetchChats().then(setChats).catch(() => {});
    }
  }, [user]);

  // Agent-widgeten varsler når en agent opprettes/slettes → oppdater listen.
  useEffect(() => {
    const reload = () => fetchChats().then(setChats).catch(() => {});
    window.addEventListener("nordavind:agents-changed", reload);
    return () => window.removeEventListener("nordavind:agents-changed", reload);
  }, []);

  // Sletting av en agent-chat: naviger bort hvis den er åpen.
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      fetchChats().then(setChats).catch(() => {});
      if (id && id === activeChatId) newChat();
    };
    window.addEventListener("nordavind:chat-deleted", onDeleted);
    return () => window.removeEventListener("nordavind:chat-deleted", onDeleted);
  }, [activeChatId]);

  const newChat = useCallback(() => {
    setActiveChatId(null);
    setSession((s) => ({ key: s.key + 1, chatId: null }));
    setView("chat");
  }, []);

  // /mail åpner e-postvisningen.
  useEffect(() => {
    const onMail = () => setView("mail");
    window.addEventListener("nordavind:open-mail", onMail);
    return () => window.removeEventListener("nordavind:open-mail", onMail);
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
    fetchChats().then(setChats).catch(() => {});
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(false);
  }, []);

  const openSettings = useCallback(() => setView("settings"), []);

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
        onLogout={logout}
      />
      <div className={styles.main}>
        {view === "settings" ? (
          <Settings user={user} />
        ) : view === "mail" ? (
          <Mail />
        ) : (
          <Chat
            key={session.key}
            chatId={session.chatId}
            initialTitle={
              session.chatId
                ? chats.find((c) => c.id === session.chatId)?.title ?? null
                : null
            }
            onChatCreated={onChatCreated}
            onTitleGenerated={() => {
              fetchChats().then(setChats).catch(() => {});
            }}
          />
        )}
      </div>
    </div>
  );
}
