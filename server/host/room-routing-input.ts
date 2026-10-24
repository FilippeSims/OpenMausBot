import type { BotRecord, Message } from "../store.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { RoomRoutingInput } from "../decider/room-routing.ts";
import { redactSecretsInText } from "../redact.ts";
import { extractTurnImages } from "../turn-images.ts";

/** Scrubbed of secrets and attachment markup before it leaves this machine. */
export function roomRoutingInput(
  roomName: string,
  text: string,
  members: readonly BotRecord[],
  history: readonly Message[],
  userName: string,
  sender?: ResolvedSender,
): RoomRoutingInput {
  const clean = (value: string) => redactSecretsInText(extractTurnImages(value).text);
  const humans = new Set<string>([userName]);
  const recent = history.flatMap((m) => {
    if (m.kind !== "text" || !m.text) return [];
    if (m.role === "user") {
      const person = m.sender?.name ?? userName;
      humans.add(person);
      return [{ from: person, text: clean(m.text) }];
    }
    return [{ from: `${m.from?.name ?? "A bot"} (bot)`, text: clean(m.text) }];
  });
  const from = sender?.name ?? userName;
  humans.add(from);
  return {
    room: roomName,
    humans: [...humans],
    members: members.map((member) => ({ id: member.id, name: member.name, title: member.title, description: member.description })),
    recent,
    message: { from, text: clean(text) },
  };
}

