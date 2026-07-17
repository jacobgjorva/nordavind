import { useEffect, useState } from "react";
import { PlusIcon, SearchIcon, SettingsIcon, SidebarIcon } from "../ui/Icons";
import { Logo } from "../ui/Logo";
import type { ChatSummary } from "../lib/api";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  chats: ChatSummary[];
  activeChatId: string | null;
  userEmail: string;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenChat: (id: string) => void;
  onLogout: () => void;
};

// Grupperer samtaler på dato: i dag / siste 7 dager / eldre.
function groupChats(chats: ChatSummary[]) {
  const today: ChatSummary[] = [];
  const week: ChatSummary[] = [];
  const older: ChatSummary[] = [];
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 7);

  for (const c of chats) {
    const t = new Date(c.updated_at);
    if (t >= startOfDay) today.push(c);
    else if (t >= weekAgo) week.push(c);
    else older.push(c);
  }
  return [
    { label: "I DAG", chats: today },
    { label: "SISTE 7 DAGER", chats: week },
    { label: "ELDRE", chats: older },
  ].filter((g) => g.chats.length > 0);
}

export function Sidebar({
  chats,
  activeChatId,
  userEmail,
  onNewChat,
  onOpenSettings,
  onOpenChat,
  onLogout,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      } else if (key === "n") {
        e.preventDefault();
        onNewChat();
      } else if (e.key === ",") {
        e.preventDefault();
        onOpenSettings();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat, onOpenSettings]);

  if (collapsed) {
    return (
      <div className={styles.railCollapsed}>
        <button
          className={styles.iconBtn}
          onClick={() => setCollapsed(false)}
          aria-label="Åpne sidemeny"
          title="Åpne sidemeny (⌘B)"
        >
          <SidebarIcon size={18} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={onNewChat}
          aria-label="Ny chat"
          title="Ny chat (⌘N)"
        >
          <PlusIcon size={18} />
        </button>
      </div>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.top}>
        <span className={styles.brand}>
          <Logo size={8} />
          Nordavind
        </span>
        <button
          className={styles.iconBtn}
          onClick={() => setCollapsed(true)}
          aria-label="Skjul sidemeny"
          title="Skjul sidemeny (⌘B)"
        >
          <SidebarIcon size={18} />
        </button>
      </div>

      <button className={styles.newChat} onClick={onNewChat}>
        <span className={styles.newChatLabel}>
          <PlusIcon size={16} />
          Ny chat
        </span>
        <kbd className={styles.kbd}>⌘N</kbd>
      </button>

      <button className={styles.navLink} onClick={onOpenSettings}>
        <span className={styles.newChatLabel}>
          <SettingsIcon size={15} />
          Settings
        </span>
        <kbd className={styles.kbd}>⌘,</kbd>
      </button>

      <button className={styles.search}>
        <SearchIcon size={15} />
        Søk i chatter
      </button>

      <nav className={styles.list}>
        {chats.length === 0 && (
          <div className={styles.emptyList}>Ingen chatter ennå</div>
        )}
        {groupChats(chats).map((g) => (
          <div key={g.label} className={styles.group}>
            <div className={styles.groupLabel}>{g.label}</div>
            {g.chats.map((c) => (
              <button
                key={c.id}
                className={`${styles.chat} ${
                  c.id === activeChatId ? styles.chatActive : ""
                }`}
                onClick={() => onOpenChat(c.id)}
              >
                {c.title}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        <span className={styles.footerEmail}>{userEmail}</span>
        <button className={styles.footerLink} onClick={onLogout}>
          Logg ut
        </button>
      </div>
    </aside>
  );
}
