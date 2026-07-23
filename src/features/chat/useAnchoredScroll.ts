import { useEffect, useRef, useState } from "react";

// Nytt spørsmål ankres i toppen av viewporten (ChatGPT-stil); svaret strømmer
// nedover derfra og brukeren eier scrollen ellers.
const ANCHOR = 96;

// useAnchoredScroll eier scroll-containeren og topbar-fade. Kalleren fester
// den returnerte ref-en på meldingslisten og leser scrolledPast.
export function useAnchoredScroll(messages: unknown[]) {
  const messagesRef = useRef<HTMLDivElement>(null);
  // Topbar fader inn når man scroller forbi første melding.
  const [scrolledPast, setScrolledPast] = useState(false);
  const hasMessages = messages.length > 0;

  // Én gang per ny melding: reserver plass i siste svar-rad slik at siste
  // spørsmål står ved ankeret når vi ligger helt nede. Ingen måling per
  // chunk — teksten strømmer inn i allerede reservert plass.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>("[data-role]");
    rows.forEach((r) => (r.style.minHeight = ""));
    const users = el.querySelectorAll<HTMLElement>('[data-role="user"]');
    const lastUser = users[users.length - 1];
    const last = rows[rows.length - 1];
    if (lastUser && last && last.dataset.role === "assistant") {
      const offset =
        last.getBoundingClientRect().top -
        lastUser.getBoundingClientRect().top;
      const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const needed = el.clientHeight - ANCHOR - padBottom - offset;
      last.style.minHeight = `${Math.max(0, needed)}px`;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Per chunk: bare hold oss helt nede (no-op til svaret overstiger
  // reservert plass).
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Fade topbar inn så snart første melding scrolles under toppen.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => setScrolledPast(el.scrollTop > 40);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMessages]);

  return { messagesRef, scrolledPast };
}
