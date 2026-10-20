import { t as uiText } from "@/lib/i18n";
// The kind comes from the card, never the pressed label: a question answered allow/deny is refused and the bot waits out its timeout.
import { QUESTION_DISMISS_MESSAGE } from "../../shared/ask-question";

interface CardKind {
  tool?: string;
}
export interface CardResponse {
  behavior: "allow" | "deny" | "answer";
  message?: string;
  dismiss?: boolean;
}

export function answerResponse(card: CardKind, answer: string): CardResponse {
  if (!card.tool) return { behavior: "answer", message: answer };
  return { behavior: answer === "Deny" ? "deny" : "allow" };
}

export function dismissResponse(card: CardKind): CardResponse {
  if (card.tool) return { behavior: "deny", message: uiText("ui.card-answer.8236457549") };
  return {
    behavior: "answer",
    message: QUESTION_DISMISS_MESSAGE,
    dismiss: true,
  };
}
