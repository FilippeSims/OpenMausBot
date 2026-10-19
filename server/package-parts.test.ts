import { expect, it } from "vitest";
import { defaultMascotAppearance } from "../shared/mascot-kit.ts";
import { mascotLookBody, partHash, releaseLook } from "./package-parts.ts";

it("preserves legacy appearance stamps and tracks layered character changes without changing the stamp shape", () => {
  const legacy = { color: "green" as const, mascotBody: "circle" };
  expect(releaseLook(legacy)).toEqual({ color: "green", mascotBody: "circle", mascotExpression: null, avatar: null, crop: null });
  const appearance = defaultMascotAppearance();
  const layered = releaseLook({ ...legacy, mascotAppearance: appearance });
  expect(Object.keys(layered)).toEqual(Object.keys(releaseLook(legacy)));
  expect(layered.mascotBody).toBe(mascotLookBody({ mascotAppearance: appearance }));
  expect(partHash(layered)).not.toBe(partHash(releaseLook(legacy)));
  expect(partHash(layered)).not.toBe(partHash(releaseLook({ ...legacy, mascotAppearance: { ...appearance, face: "04-piscadinha" } })));
});
