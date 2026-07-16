import "./logo.css";

// Brukerens originale tegning (logo.svg), merke-flate 1963x631.
// Rendres som maske slik at farge og shimmer styres med CSS —
// samme element i ro og under tenking.
const ASPECT = 1917 / 616;

export function Logo({
  size = 20,
  flutter = false,
  glow = "#ffffff",
}: {
  size?: number;
  flutter?: boolean;
  /** Fargen på lysdraget under tenking — én farge per modell */
  glow?: string;
}) {
  return (
    <span
      className={`logo-mark ${flutter ? "logo-shimmer" : ""}`}
      style={
        {
          width: size * ASPECT,
          height: size,
          "--shimmer-glow": glow,
        } as React.CSSProperties
      }
      role="img"
      aria-label="Nordavind"
    />
  );
}
