import { registerBlock } from "../../features/chat/blocks/registry";
import { MailCompose, type ComposeSpec } from "./MailCompose";

// ```mailcompose\n{JSON}\n``` → redigerbart send-kort. JSON: {to,subject,body}.
registerBlock("mailcompose", (body) => {
  let spec: ComposeSpec;
  try {
    spec = JSON.parse(body.trim());
  } catch {
    return null;
  }
  return <MailCompose spec={spec} />;
});

export { MailCompose } from "./MailCompose";
