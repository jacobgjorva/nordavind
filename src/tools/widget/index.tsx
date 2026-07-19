import { registerBlock } from "../../features/chat/blocks/registry";
import { WidgetView } from "./WidgetView";

// ```widget\n<slug>\n``` → widget-kortet.
registerBlock("widget", (body) => {
  const slug = body.trim().split(/\s+/)[0].replace(/^\//, "");
  return slug ? <WidgetView slug={slug} /> : null;
});

export { WidgetView } from "./WidgetView";
