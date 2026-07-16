import { useCallback, useEffect, useState } from "react";
import { Chat } from "../features/chat/Chat";
import { Login } from "../features/auth/Login";
import { Settings } from "../features/settings/Settings";
import { Sidebar } from "../layout/Sidebar";
import { clearToken, fetchMe, getToken, type AuthUser } from "../lib/api";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [chatKey, setChatKey] = useState(0);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
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

  const newChat = useCallback(() => {
    setChatKey((k) => k + 1);
    setChatTitle(null);
    setView("chat");
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(false);
  }, []);

  const openSettings = useCallback(() => setView("settings"), []);
  const openChat = useCallback(() => setView("chat"), []);

  if (user === null) return null; // validerer sesjon
  if (user === false) return <Login onLogin={setUser} />;

  return (
    <div className={styles.app}>
      <Sidebar
        chatTitle={chatTitle}
        userEmail={user.email}
        onNewChat={newChat}
        onOpenSettings={openSettings}
        onOpenChat={openChat}
        onLogout={logout}
        inSettings={view === "settings"}
      />
      <div className={styles.main}>
        <header className={styles.topBar} />
        {view === "chat" ? (
          <Chat key={chatKey} onTitle={setChatTitle} />
        ) : (
          <Settings />
        )}
      </div>
    </div>
  );
}
