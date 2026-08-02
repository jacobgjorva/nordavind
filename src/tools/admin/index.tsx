import { createContext, useContext } from "react";
import { registerBlock } from "../../features/chat/blocks/registry";
import { Admin } from "../../features/settings/Admin";
import { Documents } from "../../features/settings/Documents";
import { Employees } from "../../features/settings/Employees";
import { Units } from "../../features/settings/Units";
import { KnowledgeGraph } from "../../features/settings/KnowledgeGraph";
import { Quota } from "../../features/settings/Quota";
import { Usage } from "../../features/settings/Usage";
import { ConnectorsInline } from "./ConnectorsInline";
import styles from "./AdminPanel.module.css";

// Admin-styring i chatten: settings-komponentene kalles inn som blokker via
// slash-kommandoer (```admin\n<panel>```). Settings-siden fases ut — all
// styring skal skje sammen med agenten i chatten.

// Innlogget brukers id — Admin-panelet trenger den (kan ikke fjerne seg selv).
export const AdminUserContext = createContext<string>("");

function AdminPanel({ panel }: { panel: string }) {
  const userId = useContext(AdminUserContext);
  const inner =
    panel === "tilganger" ? (
      <Admin currentUserId={userId} />
    ) : panel === "forbruk" ? (
      <Usage />
    ) : panel === "dokumenter" ? (
      <Documents />
    ) : panel === "ansatte" ? (
      <Employees />
    ) : panel === "enheter" ? (
      <Units />
    ) : panel === "graf" ? (
      <KnowledgeGraph />
    ) : panel === "kvote" ? (
      <Quota />
    ) : panel === "tilkoblinger" ? (
      <ConnectorsInline />
    ) : null;
  if (!inner) return null;
  return <div className={styles.panelCard}>{inner}</div>;
}

registerBlock("admin", (body) => {
  const panel = body.trim().split(/\s+/)[0]?.toLowerCase();
  return panel ? <AdminPanel panel={panel} /> : null;
});
