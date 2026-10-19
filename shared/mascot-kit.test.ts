import { describe, expect, it } from "vitest";
import { botMascotAppearance, defaultMascotAppearance, mascotAppearanceSchema } from "./mascot-kit";

describe("layered bot appearance", () => {
  it("normalizes placements and retains the exact layer order", () => {
    const result = mascotAppearanceSchema.parse({ body: "14-robo", accessories: [{ id: "01-coroa" }, { id: "04-oculos-redondos", x: 3, scale: 0.8 }] });
    expect(result).toEqual({ body: "14-robo", face: "auto", accessories: [
      { id: "01-coroa", x: 0, y: 0, scale: 1, rotation: 0 },
      { id: "04-oculos-redondos", x: 3, y: 0, scale: 0.8, rotation: 0 },
    ] });
  });
  it("accepts catalog IDs only, with bounded placements and no duplicate layers", () => {
    const base = defaultMascotAppearance();
    for (const invalid of [
      { ...base, body: "../../config" }, { ...base, face: "<script>" }, { ...base, svg: "<svg/>" },
      { ...base, accessories: [{ id: "https://example.test/tracker.svg" }] },
      ...[{ x: 65 }, { y: -65 }, { scale: 0 }, { scale: 2.1 }, { rotation: 181 }, { x: Number.NaN }, { svg: "<svg/>" }]
        .map(patch => ({ ...base, accessories: [{ id: "01-coroa", ...patch }] })),
      { ...base, accessories: [{ id: "01-coroa" }, { id: "01-coroa" }] },
      { ...base, accessories: Array.from({ length: 9 }, () => ({ id: "01-coroa" })) },
    ]) expect(mascotAppearanceSchema.safeParse(invalid).success).toBe(false);
  });
  it("safely falls back to the classic mascot for absent or damaged saved appearances", () => {
    for (const value of [undefined, null, "14-robo", {}, { body: "unavailable" }, { ...defaultMascotAppearance(), accessories: "bad" }]) {
      expect(botMascotAppearance(value)).toBeNull();
    }
  });
});
