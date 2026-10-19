import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KIT_ACCESSORY_IDS, KIT_BODY_IDS, KIT_FACE_IDS, defaultMascotAppearance } from "../../shared/mascot-kit";
import { kitLayerMarkup } from "@/lib/bot-kit-art";
import { BotAvatar } from "./Avatar";

describe("bundled character artwork", () => {
  it("ships every body, face and accessory as self-contained vector layers", () => {
    for (const [kind, ids] of [["bodies", KIT_BODY_IDS], ["faces", KIT_FACE_IDS], ["accessories", KIT_ACCESSORY_IDS]] as const) {
      for (const id of ids) {
        const markup = kitLayerMarkup(kind, id, "fixture");
        expect(markup, id).toMatch(/<(path|rect|g|polygon|ellipse|circle)\b/);
        expect(markup).not.toMatch(/<(svg|script|foreignObject|image)\b|\bon\w+=|(?:https?:|javascript:|data:)/i);
        for (const match of markup.matchAll(/url\(#([^)]+)\)/g)) expect(markup).toContain(`id="${match[1]}"`);
      }
    }
  });
  it("layers the owner's shapes, faces and accessories with per-avatar color and transforms", () => {
    const appearance = { ...defaultMascotAppearance(), body: "17-gatinho" as const, face: "04-piscadinha" as const,
      accessories: [{ id: "01-coroa" as const, x: 2, y: -3, scale: 0.85, rotation: 10 }] };
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { name: "Kitten", color: "purple", mascotAppearance: appearance }, animated: false }));
    expect(html).toContain('data-mascot-kit="17-gatinho"');
    expect(html).toContain('data-kit-face="04-piscadinha"');
    expect(html).toContain("color:#8057C8");
    expect(html).toContain("translate(2 -3) translate(64 64) rotate(10) scale(0.85)");
    expect(html.indexOf('data-kit-layer="body"')).toBeLessThan(html.indexOf('data-kit-layer="face"'));
    expect(html.indexOf('data-kit-layer="face"')).toBeLessThan(html.indexOf('data-kit-accessory="01-coroa"'));
  });
  it("keeps gradient IDs independent when several customized bots appear together", () => {
    const appearance = { ...defaultMascotAppearance(), accessories: [{ id: "01-coroa" as const, x: 0, y: 0, scale: 1, rotation: 0 }] };
    const html = renderToStaticMarkup(createElement("div", null, ...["green", "purple", "blue"].map(color =>
      createElement(BotAvatar, { key: color, bot: { color: color as "green", mascotAppearance: appearance }, animated: false }))));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
  });
  it("switches an automatic face with activity while keeping a chosen face fixed", () => {
    const render = (face: "auto" | "17-apaixonado") => renderToStaticMarkup(createElement(BotAvatar, {
      bot: { color: "green", mascotAppearance: { ...defaultMascotAppearance(), face } }, state: "working", animated: false,
    }));
    expect(render("auto")).toContain('data-kit-face="08-focado"');
    expect(render("17-apaixonado")).toContain('data-kit-face="17-apaixonado"');
  });
});
