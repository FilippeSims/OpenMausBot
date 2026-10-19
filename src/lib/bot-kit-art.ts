import type { KitFaceId } from "../../shared/mascot-kit";
import type { MausState } from "./mascot";

const artwork = import.meta.glob<string>("../assets/bot-kit/**/*.svg", { eager: true, query: "?raw", import: "default" });

export function kitLayerMarkup(kind: "bodies" | "faces" | "accessories", id: string, instance: string): string {
  const svg = artwork[`../assets/bot-kit/${kind}/${id}.svg`];
  if (!svg) return "";
  return svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")
    .replace(/\bid="([^"]+)"/g, (_, name: string) => `id="${instance}-${name}"`)
    .replace(/url\(#([^)]+)\)/g, (_, name: string) => `url(#${instance}-${name})`);
}

export function automaticKitFace(state: MausState): KitFaceId {
  switch (state) {
    case "sleeping": case "drowsy": case "powering-down": return "07-sonolento";
    case "thinking": case "searching": case "radar": return "19-pensativo";
    case "working": case "writing": case "progress": return "08-focado";
    case "happy": case "celebrate": case "excited": case "spawning": return "03-feliz";
    case "surprised": case "waking": return "06-surpreso";
    case "suspicious": return "12-desconfiado";
    case "angry": case "proud": return "18-determinado";
    case "sad": case "scared": case "alerting": return "13-preocupado";
    case "confused": return "15-confuso";
    case "shy": return "10-timido";
    case "laughing": return "14-risada";
    case "playful": return "09-travesso";
    case "listening": case "curious": case "notifying": return "05-curioso";
    case "bored": return "20-relaxado";
    default: return "01-sorriso";
  }
}
