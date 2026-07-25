import { Component, type ReactNode } from "react";

// Øverste sikkerhetsnett: en uventet feil i én komponent skal aldri gi hvit
// side — vis en rolig feilmelding med mulighet til å laste inn på nytt.
export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("app-feil fanget:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, color: "#eee", background: "#111" }}>
          <div>Noe gikk galt i visningen.</div>
          <button
            style={{ padding: "7px 16px", borderRadius: 9, border: "0.5px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.06)", color: "#eee", cursor: "pointer" }}
            onClick={() => window.location.reload()}
          >
            Last inn på nytt
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
