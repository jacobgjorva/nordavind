import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AnonymousIcon,
  Folder01Icon,
  Folder02Icon,
} from "@hugeicons/core-free-icons";
import { PlusIcon, SearchIcon, SettingsIcon } from "../ui/Icons";
import { on } from "../lib/events";
import { Logo } from "../ui/Logo";
import type { ChatSummary, Folder } from "../lib/api";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  chats: ChatSummary[];
  folders: Folder[];
  activeChatId: string | null;
  userEmail: string;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onNewFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveChatToFolder: (chatId: string, folderId: string) => void;
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
  folders,
  activeChatId,
  userEmail,
  onNewChat,
  onOpenSettings,
  onOpenChat,
  onDeleteChat,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveChatToFolder,
  onLogout,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(true);
  // Chat-headeren eier toggle-knappen nå.
  useEffect(() => on("sidebar-toggle", () => setCollapsed((c) => !c)), []);
  // Åpne/lukkede mapper + hvilken mappe man drar over (for hover-uthevingen).
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);

  function del(e: React.MouseEvent, c: ChatSummary) {
    e.stopPropagation();
    if (confirm(`Slette «${c.title}»?`)) onDeleteChat(c.id);
  }

  // Én chat-rad: klikkbar, slettbar og drabar (drag inn i en mappe).
  function chatRow(c: ChatSummary) {
    return (
      <div
        key={c.id}
        className={styles.chatRow}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/chat", c.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <button
          className={`${styles.chat} ${
            c.id === activeChatId ? styles.chatActive : ""
          }`}
          onClick={() => onOpenChat(c.id)}
        >
          {c.title}
        </button>
        <button
          className={styles.chatDelete}
          onClick={(e) => del(e, c)}
          aria-label="Slett"
          title="Slett"
        >
          ×
        </button>
      </div>
    );
  }

  // Agent-chatter pinnes øverst; mappe-chatter vises i mappa; resten i historikk.
  const agentChats = chats.filter((c) => c.agent_id);
  const regularChats = chats.filter((c) => !c.agent_id && !c.folder_id);

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

  if (collapsed) return null;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.top}>
        <span className={styles.brand}>
          <Logo size={8} />
          Nordavind
        </span>
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
        {agentChats.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>AGENTER</div>
            {agentChats.map((c) => (
              <div key={c.id} className={styles.chatRow}>
                <button
                  className={`${styles.chat} ${styles.chatAgent} ${
                    c.id === activeChatId ? styles.chatActive : ""
                  }`}
                  onClick={() => onOpenChat(c.id)}
                >
                  <HugeiconsIcon icon={AnonymousIcon} size={14} className={styles.chatIcon} />
                  <span className={styles.chatTitleText}>{c.title}</span>
                  {c.agent_enabled && (
                    <span className={styles.agentLive} aria-label="Aktiv" />
                  )}
                </button>
                <button
                  className={styles.chatDelete}
                  onClick={(e) => del(e, c)}
                  aria-label="Slett"
                  title="Slett"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Mapper: mellom agenter og historikk. Dra chatter hit for å organisere. */}
        <div className={styles.group}>
          <div className={styles.folderHeader}>
            <span className={styles.groupLabel}>MAPPER</span>
            <button
              className={styles.newFolderBtn}
              onClick={onNewFolder}
              title="Ny mappe"
            >
              <PlusIcon size={13} />
              Ny mappe
            </button>
          </div>
          {folders.map((f) => {
            const inFolder = chats.filter((c) => c.folder_id === f.id);
            const open = openFolders[f.id];
            return (
              <div
                key={f.id}
                className={`${styles.folder} ${
                  dragOver === f.id ? styles.folderDragOver : ""
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(f.id);
                }}
                onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/chat");
                  if (id) {
                    onMoveChatToFolder(id, f.id);
                    setOpenFolders((o) => ({ ...o, [f.id]: true }));
                  }
                }}
              >
                <div
                  className={styles.folderHead}
                  onClick={() =>
                    setOpenFolders((o) => ({ ...o, [f.id]: !o[f.id] }))
                  }
                >
                  <HugeiconsIcon
                    icon={open ? Folder02Icon : Folder01Icon}
                    size={15}
                    className={styles.folderIcon}
                  />
                  <span
                    className={styles.folderName}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const name = prompt("Nytt mappenavn", f.name);
                      if (name && name.trim()) onRenameFolder(f.id, name.trim());
                    }}
                  >
                    {f.name}
                  </span>
                  {inFolder.length > 0 && (
                    <span className={styles.folderCount}>{inFolder.length}</span>
                  )}
                  <button
                    className={styles.chatDelete}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Slette mappa «${f.name}»? Chattene beholdes.`))
                        onDeleteFolder(f.id);
                    }}
                    aria-label="Slett mappe"
                    title="Slett mappe"
                  >
                    ×
                  </button>
                </div>
                {open && (
                  <div className={styles.folderBody}>
                    {inFolder.length === 0 ? (
                      <div className={styles.folderEmpty}>Dra chatter hit</div>
                    ) : (
                      inFolder.map((c) => chatRow(c))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {groupChats(regularChats).map((g) => (
          <div key={g.label} className={styles.group}>
            <div className={styles.groupLabel}>{g.label}</div>
            {g.chats.map((c) => chatRow(c))}
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
