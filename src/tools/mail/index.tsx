import { registerBlock } from "../../chat/blocks/registry";
import { MailThread, MailReply } from "./Mail";

// ```mailthread\n<key>``` → tråd-kortet, ```mailreply\n<key>``` → svarforslag.
registerBlock("mailthread", (body) => {
  const key = body.trim();
  return key ? <MailThread threadKey={key} /> : null;
});
registerBlock("mailreply", (body) => {
  const key = body.trim();
  return key ? <MailReply threadKey={key} /> : null;
});

export { MailThread, MailReply } from "./Mail";
