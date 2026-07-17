import { useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";
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
  const [view, setView] = useState<"chat" | "settings">("chat");
  // session styrer remount av Chat; activeChatId er kun sidebar-markering.
  // De er adskilt slik at opprettelse av samtale midt i en stream ikke
  // remonter komponenten og dreper streamen.
  const [session, setSession] = useState<{ key: number; chatId: string | null }>(
    { key: 0, chatId: null }
  );
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

  const newChat = useCallback(() => {
    setActiveChatId(null);
    setSession((s) => ({ key: s.key + 1, chatId: null }));
    setView("chat");
  }, []);

  const openChat = useCallback((id: string) => {
    setActiveChatId(id);
    setSession((s) => ({ key: s.key + 1, chatId: id }));
    setView("chat");
  }, []);

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
        <header className={styles.topBar} />
        {view === "chat" ? (
          <Chat
            key={session.key}
            chatId={session.chatId}
            onChatCreated={onChatCreated}
          />
        ) : (
          <Settings user={user} />
        )}
      </div>
    </div>
  );
}
