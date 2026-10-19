import { z } from "zod";

export const KIT_BODY_IDS = ["01-estrela", "02-quadrado-suave", "03-gota", "04-triangulo", "05-hexagono", "06-lua", "07-flor", "08-nuvem", "09-capsula", "10-losango", "11-ameba", "12-coracao", "13-chifrinhos", "14-robo", "15-pedra", "16-brilho", "17-gatinho", "18-fantasma", "19-feijao", "20-oval", "21-sol", "22-arco", "23-pentagono", "24-trevo"] as const;
export const KIT_FACE_IDS = ["01-sorriso", "02-neutro", "03-feliz", "04-piscadinha", "05-curioso", "06-surpreso", "07-sonolento", "08-focado", "09-travesso", "10-timido", "11-animado", "12-desconfiado", "13-preocupado", "14-risada", "15-confuso", "16-encantado", "17-apaixonado", "18-determinado", "19-pensativo", "20-relaxado"] as const;
export const KIT_ACCESSORY_IDS = ["01-coroa", "02-oculos-sol", "03-oculos-redondos-sol", "04-oculos-redondos", "05-monoculo", "06-tapa-olho", "07-bone", "08-cartola", "09-chapeu-mago", "10-chapeu-festa", "11-fones", "12-headset", "13-aureola", "14-chifres", "15-laco", "16-gravata-borboleta", "17-gravata", "18-bigode", "19-barba", "20-flor", "21-raio", "22-estrela-xerife", "23-louros", "24-antena"] as const;
export const MAX_KIT_ACCESSORIES = 8;

export const kitAccessorySchema = z.object({
  id: z.enum(KIT_ACCESSORY_IDS),
  x: z.number().finite().min(-64).max(64).default(0),
  y: z.number().finite().min(-64).max(64).default(0),
  scale: z.number().finite().min(0.4).max(2).default(1),
  rotation: z.number().finite().min(-180).max(180).default(0),
}).strict();

/** Bundled artwork IDs and placement in the kit's 128 × 128 coordinate system; no paths or SVG markup are accepted. */
export const mascotAppearanceSchema = z.object({
  body: z.enum(KIT_BODY_IDS),
  face: z.enum(["auto", ...KIT_FACE_IDS]).default("auto"),
  accessories: z.array(kitAccessorySchema).max(MAX_KIT_ACCESSORIES)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "Each accessory can be used once").default([]),
}).strict();

export type MascotAppearance = z.infer<typeof mascotAppearanceSchema>;
export type KitAccessory = z.infer<typeof kitAccessorySchema>;
export type KitBodyId = typeof KIT_BODY_IDS[number];
export type KitFaceId = typeof KIT_FACE_IDS[number];
export type KitAccessoryId = typeof KIT_ACCESSORY_IDS[number];

export function botMascotAppearance(value: unknown): MascotAppearance | null {
  return mascotAppearanceSchema.safeParse(value).data ?? null;
}

export function defaultMascotAppearance(): MascotAppearance {
  return { body: "14-robo", face: "auto", accessories: [] };
}
