import { useCallback, useState } from "react";
import { Chat } from "../features/chat/Chat";
import { Settings } from "../features/settings/Settings";
import { Sidebar } from "../layout/Sidebar";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [chatKey, setChatKey] = useState(0);
  const [chatTitle, setChatTitle] = useState<string | null>(null);

  const newChat = useCallback(() => {
    setChatKey((k) => k + 1);
    setChatTitle(null);
    setView("chat");
  }, []);

  const openSettings = useCallback(() => setView("settings"), []);
  const openChat = useCallback(() => setView("chat"), []);

  return (
    <div className={styles.app}>
      <Sidebar
        chatTitle={chatTitle}
        onNewChat={newChat}
        onOpenSettings={openSettings}
        onOpenChat={openChat}
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
