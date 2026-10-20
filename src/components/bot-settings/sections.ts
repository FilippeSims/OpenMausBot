import { t as uiText } from "@/lib/i18n";
import {
  BookOpen,
  Brain,
  CalendarClock,
  Coins,
  Cpu,
  Eye,
  History,
  LayoutDashboard,
  type LucideIcon,
  Mic,
  Network,
  ShieldCheck,
  Slack,
  Sparkles,
  User,
} from "lucide-react";

import type { BotSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";

export const BOT_SECTIONS: Array<{
  id: BotSettingsSection;
  label: string;
  labelKey?: LocaleKey;
  icon: LucideIcon;
  keywords: string[];
}> = [
  { id: "overview", get label() { return uiText("ui.sections.d4b1ea5708"); }, icon: LayoutDashboard, keywords: ["summary", "status", "what it does", "won't", "prompt", "what the model sees"] },
  { id: "identity", get label() { return uiText("ui.sections.999f23fcd7"); }, icon: User, keywords: ["name", "title", "avatar", "blurb", "instructions"] },
  { id: "slack", get label() { return uiText("ui.sections.b27fb38ba3"); }, icon: Slack, keywords: ["slack", "slack app", "admin", "message", "direct messages", "mentions"] },
  { id: "soul", get label() { return uiText("ui.sections.70629416ec"); }, icon: Sparkles, keywords: ["standing instructions", "instructions", "persona", "rules", "soul.md"] },
  { id: "skills", get label() { return uiText("onboarding.import.skills"); }, icon: BookOpen, keywords: ["skills", "learned", "procedures", "teach"] },
  { id: "memory", get label() { return uiText("botSettings.simple.memory"); }, icon: Brain, keywords: ["memory", "notes", "remember", "topics"] },
  { id: "routines", get label() { return uiText("botSettings.simple.routines"); }, icon: CalendarClock, keywords: ["schedule", "routines", "cron", "tasks"] },
  { id: "access", get label() { return uiText("ui.sections.ec5ba0abb7"); }, icon: Network, keywords: ["works on", "computer", "vm", "cloud", "vps", "folder", "workspace", "browser", "connected apps", "composio", "webhooks", "always allow", "grants", "tool selection", "tools", "mcp", "allow", "exclude"] },
  { id: "model", get label() { return uiText("teamSettings.model"); }, icon: Cpu, keywords: ["engine", "model", "provider", "cli", "effort"] },
  { id: "permissions", get label() { return uiText("onboarding.perms.title"); }, icon: ShieldCheck, keywords: ["auto mode", "approve", "auto approve", "review", "routine approvals", "peers", "contact", "coordination", "chief of staff", "section"] },
  { id: "voice", get label() { return uiText("ui.sections.cad3b82bec"); }, icon: Mic, keywords: ["voice", "alerts", "notifications", "speak"] },
  { id: "visibility", get label() { return uiText("botSettings.visibility.title"); }, labelKey: "botSettings.visibility.title", icon: Eye, keywords: ["visibility", "who can see", "private", "people", "admins", "members", "access", "hide"] },
  { id: "history", get label() { return uiText("usage.history.title"); }, icon: History, keywords: ["history", "changes", "undo", "rollback", "log"] },
  { id: "usage", get label() { return uiText("settings.section.usage"); }, icon: Coins, keywords: ["tokens", "cost", "billing"] },
];
