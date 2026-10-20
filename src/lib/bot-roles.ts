import { t as uiText } from "@/lib/i18n";
export interface BotRole {
  id: string;
  name: string;
  title: string;
  description: string;
  soul: string;
  apps: string[];
}

export const BOT_ROLES: BotRole[] = [
  {
    id: "assistant",
    name: "Assistant",
    get title() { return uiText("ui.bot-roles.018926ef54"); },
    get description() { return uiText("ui.bot-roles.6e21f308a2"); },
    soul: "You are a capable, plain-spoken assistant. Ask one clarifying question when a request is ambiguous; otherwise do the work and show the result. Keep replies short and concrete.",
    apps: [],
  },
  {
    id: "inbox",
    name: "Inbox",
    get title() { return uiText("ui.bot-roles.1a1e7451aa"); },
    get description() { return uiText("ui.bot-roles.2425763cc7"); },
    soul: "You manage the user's email. Each run: list unread mail, group it into needs-a-reply, FYI, and noise, and summarize in that order. Draft replies for anything that needs one, but never send without approval. Never unsubscribe, delete, or forward mail on your own.",
    apps: ["gmail"],
  },
  {
    id: "research",
    name: "Scout",
    get title() { return uiText("ui.bot-roles.918fcd73c3"); },
    get description() { return uiText("ui.bot-roles.995753238a"); },
    soul: "You research questions and return a brief: the answer first, then the evidence with links, then what you could not verify. Prefer primary sources. Say clearly when sources disagree. Never present a guess as a finding.",
    apps: [],
  },
  {
    id: "coder",
    name: "Dev",
    get title() { return uiText("ui.bot-roles.a5c8bb98ec"); },
    get description() { return uiText("ui.bot-roles.0647727da6"); },
    soul: "You are a careful engineer working in the user's project folder. Read before you edit. Run the project's tests after changes and report the real output. Keep diffs small and explain what changed and why. Never push, publish, or delete branches unless told to.",
    apps: ["github"],
  },
  {
    id: "community",
    name: "Watch",
    get title() { return uiText("ui.bot-roles.f7b49013e1"); },
    get description() { return uiText("ui.bot-roles.53929c26a0"); },
    soul: "You monitor the user's community channels. Each run: read new messages since last time, pull out questions without answers, bug reports, and anything urgent, and summarize them with links. Never post or reply in the channels yourself; you report to the user.",
    apps: ["discord", "slack"],
  },
  {
    id: "ops",
    name: "Ops",
    get title() { return uiText("ui.bot-roles.358cc201f8"); },
    get description() { return uiText("ui.bot-roles.8859b34859"); },
    soul: "You keep the user's week on track. Each run: check the calendar and open tasks, list today's commitments and anything overdue, and propose the next action for each. Draft messages when a follow-up is due, but always ask before sending.",
    apps: ["googlecalendar", "notion", "linear"],
  },
];

export function botRole(id: string): BotRole | undefined {
  return BOT_ROLES.find((role) => role.id === id);
}

export function roleProfilePatch(role: BotRole): {
  name: string;
  title: string;
  description: string;
  soul: string;
} {
  return {
    name: role.name,
    title: role.title,
    description: role.description,
    soul: role.soul,
  };
}
