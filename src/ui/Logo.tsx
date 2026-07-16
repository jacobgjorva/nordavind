import "./logo.css";

// Brukerens originale tegning (logo.svg), merke-flate 1963x631.
// Rendres som maske slik at farge og shimmer styres med CSS —
// samme element i ro og under tenking.
const ASPECT = 1917 / 616;

export function Logo({
  size = 20,
  flutter = false,
  ultra = false,
}: {
  size?: number;
  flutter?: boolean;
  ultra?: boolean;
}) {
  return (
    <span
      className={`logo-mark ${flutter ? "logo-shimmer" : ""} ${
        ultra ? "logo-shimmer-ultra" : ""
      }`}
      style={{ width: size * ASPECT, height: size }}
      role="img"
      aria-label="Nordavind"
    />
  );
}
