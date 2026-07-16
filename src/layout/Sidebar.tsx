import { useEffect, useState } from "react";
import { PlusIcon, SearchIcon, SettingsIcon, SidebarIcon } from "../ui/Icons";
import { Logo } from "../ui/Logo";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  chatTitle: string | null;
  userEmail: string;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenChat: () => void;
  onLogout: () => void;
  inSettings: boolean;
};

export function Sidebar({
  chatTitle,
  userEmail,
  onNewChat,
  onOpenSettings,
  onOpenChat,
  onLogout,
  inSettings,
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
          <Logo size={18} />
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
        <div className={styles.group}>
          <div className={styles.groupLabel}>I DAG</div>
          {chatTitle ? (
            <button
              className={`${styles.chat} ${!inSettings ? styles.chatActive : ""}`}
              onClick={onOpenChat}
            >
              {chatTitle}
            </button>
          ) : (
            <div className={styles.emptyList}>Ingen chatter ennå</div>
          )}
        </div>
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
