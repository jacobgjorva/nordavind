import { registerBlock } from "../../features/chat/blocks/registry";
import { ExportCard } from "./ExportCard";

// ```export\n{"columns":[...],"rows":[[...]]}\n``` → eksportkort i chatten.
registerBlock("export", (body) => {
  const d = JSON.parse(body);
  return <ExportCard title={d.title ?? "Eksport"} columns={d.columns ?? []} rows={d.rows ?? []} />;
});
