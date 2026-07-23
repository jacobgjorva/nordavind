import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ThumbsUpIcon,
  ThumbsDownIcon,
  Eraser01Icon,
  CornerDownLeftIcon,
} from "@hugeicons/core-free-icons";
import {
  acceptNode,
  fetchPendingNodes,
  rejectNode,
  type KnowledgeNode,
} from "../../lib/api";
import styles from "./Knowledge.module.css";

// Governance-side: admin ser én foreslått kunnskapsnode av gangen og
// aksepterer eller avviser den. Kun aksepterte noder brukes av AI-en.
export function Knowledge() {
  const [queue, setQueue] = useState<KnowledgeNode[] | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = queue?.[0] ?? null;

  useEffect(() => {
    fetchPendingNodes()
      .then(setQueue)
      .catch(() => setError("Kunne ikke hente forslag."));
  }, []);

  useEffect(() => {
    if (current) {
      setTitle(current.title);
      setSummary(current.summary);
    }
  }, [current?.id]);

  function next() {
    setQueue((q) => (q ? q.slice(1) : q));
  }

  async function accept() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptNode(current.id, title.trim(), summary.trim());
      next();
    } catch {
      setError("Kunne ikke godkjenne.");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rejectNode(current.id);
      next();
    } catch {
      setError("Kunne ikke avvise.");
    } finally {
      setBusy(false);
    }
  }

  // Hurtigtaster: Enter = godkjenn, Delete = avvis.
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        accept();
      } else if (e.key === "Delete") {
        e.preventDefault();
        reject();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current?.id, busy, title, summary]);

  if (!queue) return null;

  return (
    <div className={styles.content}>
      {!current ? (
        <div className={styles.empty}>Ingen forslag venter. 🎉</div>
      ) : (
        <div className={styles.stack}>
          {current.user_email && (
            <div className={styles.source}>Fra {current.user_email}</div>
          )}
          <textarea
            className={styles.textarea}
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <div className={styles.actionCol}>
              <button
                className={styles.reject}
                onClick={reject}
                disabled={busy}
                aria-label="Avvis"
              >
                <HugeiconsIcon icon={ThumbsDownIcon} size={20} />
              </button>
              <kbd className={styles.hint}>
                <HugeiconsIcon
                  icon={Eraser01Icon}
                  size={13}
                  style={{ transform: "scaleX(-1)" }}
                />
              </kbd>
            </div>
            <div className={styles.actionCol}>
              <button
                className={styles.accept}
                onClick={accept}
                disabled={busy || !title.trim() || !summary.trim()}
                aria-label="Godkjenn"
              >
                <HugeiconsIcon icon={ThumbsUpIcon} size={20} />
              </button>
              <kbd className={styles.hint}>
                <HugeiconsIcon icon={CornerDownLeftIcon} size={13} />
              </kbd>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
