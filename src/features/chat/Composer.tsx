import type { ReactNode, RefObject } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Attachment01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import type { AnonymousIcon } from "@hugeicons/core-free-icons";
import styles from "./Chat.module.css";

// Composer er meldingsfeltet — ETT felt for hele appen. Chatten, agent-chatten
// og designsiden bruker samme komponent, så tekstfelt, vedlegg, slash-meny og
// bunnlinje ser like ut og oppfører seg likt overalt.

export interface SlashItem {
  cmd: string;
  label: string;
  desc: string;
  icon: typeof AnonymousIcon;
  tag?: string;
}

export function Composer({
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
  textareaRef,
  fileInputRef,
  onFiles,
  slashItems,
  slashIndex,
  onSlashHover,
  onSlashPick,
  model,
  modelHint,
  left,
  right,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  onFiles?: (files: FileList | null) => void;
  /** Slash-menyen — utelates der kommandoer ikke gir mening. */
  slashItems?: SlashItem[];
  slashIndex?: number;
  onSlashHover?: (i: number) => void;
  onSlashPick?: (cmd: string) => void;
  model?: string;
  modelHint?: string;
  /** Ekstra kontroller i bunnlinjen (rolle-pille, egne knapper). */
  left?: ReactNode;
  right?: ReactNode;
}) {
  const slashOpen = (slashItems?.length ?? 0) > 0;
  return (
    <div className={styles.composer}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={1}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          autoFocus
        />
      </div>
      {slashOpen && (
        <div className={styles.slashBody}>
          <ul className={styles.slashList}>
            {slashItems!.map((a, i) => (
              <li key={a.cmd}>
                <button
                  type="button"
                  className={`${styles.slashItem} ${
                    i === slashIndex ? styles.slashItemActive : ""
                  }`}
                  onMouseEnter={() => onSlashHover?.(i)}
                  onClick={() => onSlashPick?.(a.cmd)}
                >
                  <HugeiconsIcon
                    icon={a.icon}
                    size={16}
                    className={styles.slashIcon}
                  />
                  <span className={styles.slashLabel}>{a.label}</span>
                  {a.tag && <span className={styles.slashTag}>{a.tag}</span>}
                  <span className={styles.slashHint}>{a.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.footer}>
        {onFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.docx,.txt,.md,.csv,.json,.log,text/*,image/*"
              onChange={(e) => onFiles(e.target.files)}
            />
            <button
              className={`${styles.actionBtn} ${styles.attachBtn}`}
              onClick={() => fileInputRef?.current?.click()}
              title="Legg ved fil"
              aria-label="Legg ved fil"
            >
              <HugeiconsIcon icon={Attachment01Icon} size={16} strokeWidth={2} />
            </button>
          </>
        )}
        {left}
        <span className={styles.footerRight}>
          {right}
          {model && (
            <span className={styles.modelInfo}>
              <HugeiconsIcon icon={FlashIcon} size={13} strokeWidth={2} />
              <span className={styles.modelName}>{model}</span>
              {modelHint && <span className={styles.modelHint}>{modelHint}</span>}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
