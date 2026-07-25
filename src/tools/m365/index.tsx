import { registerBlock } from "../../features/chat/blocks/registry";
import { M365Auth } from "./M365Auth";
import { M365AppForm } from "./M365AppForm";

// ```m365auth``` → innloggingssteget; ```m365app``` → app-registreringsskjemaet.
registerBlock("m365auth", () => <M365Auth />);
registerBlock("m365app", () => <M365AppForm />);
