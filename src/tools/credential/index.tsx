import { registerBlock } from "../../features/chat/blocks/registry";
import { CredentialForm, type CredentialSpec } from "./CredentialForm";

// ```credential\n{JSON}\n``` → sikkert tilkoblingskort. JSON kan forhåndsfylle
// name/driver/host/port/database/user — ALDRI passord.
registerBlock("credential", (body) => {
  let spec: CredentialSpec = {};
  const raw = body.trim();
  if (raw) {
    try {
      spec = JSON.parse(raw);
    } catch {
      spec = {};
    }
  }
  return <CredentialForm spec={spec} />;
});

export { CredentialForm } from "./CredentialForm";
