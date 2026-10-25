import { createRoot } from "react-dom/client";
import { ComputerFilesPane } from "../../src/components/ComputerFilesPane";
import { FilePreviewPanel } from "../../src/components/FilePreviewPanel";
import { ChatMarkdown } from "../../src/components/ChatMarkdown";
import { MessageAttachmentGallery } from "../../src/components/AttachmentGallery";
import { BotEditorStore, initialState, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setAnalyticsEnabled } from "../../src/lib/analytics";
import { setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

setAnalyticsEnabled(false);
setLocale("en");
applySkin(new URLSearchParams(location.search).get("skin") === "atelier" ? "atelier" : "midnight");
const bot: Bot = await fetch("/__computer-files-fixture").then((response) => response.json());
const value = {
  state: { ...initialState, bots: [bot], selectedId: bot.id },
  dispatch: () => {},
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
};
createRoot(document.getElementById("root")!).render(
  <BotEditorStore value={value}>
    <div className="flex h-dvh overflow-hidden bg-app text-ink">
    <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-app pt-6 text-ink">
      <h1 className="mb-4 px-5 text-lg font-medium">File reviewer · Files</h1>
      {bot.messages.filter(message => message.kind === "text" && message.role === "bot").map(message => <div key={message.id} className="space-y-4 px-5 pb-4">
        <ChatMarkdown text={message.text ?? ""} message={{ threadId: bot.threadId, messageId: message.id }} />
        <MessageAttachmentGallery text={message.text ?? ""} message={{ threadId: bot.threadId, messageId: message.id }} />
      </div>)}
      <ComputerFilesPane bot={bot} />
    </main>
    <FilePreviewPanel />
    </div>
  </BotEditorStore>,
);
