// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { HindsightSettings } from "./HindsightSettings";
const fixture = vi.hoisted(() => ({ config: {} as Record<string, unknown>, api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }) }));
let host: HTMLDivElement;
let root: Root;
const render = () => flushSync(() => root.render(createElement(HindsightSettings)));
const click = (text: string) => flushSync(() => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click());
const type = (id: string, value: string) => {
  const field = host.querySelector<HTMLInputElement>(`#hindsight-${id}`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
};
beforeEach(() => {
  vi.clearAllMocks(); setLocale("pt-br");
  fixture.config = { memory: { hindsight: { available: true, enabled: false, error: null, pending: false, indexedDocuments: 0 } } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
it("refuses invalid URLs and limits without modifying saved settings", async () => {
  render(); type("url", "http://remote.example"); click("Salvar");
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("HTTP local"));
  expect(fixture.api).not.toHaveBeenCalled();
  type("url", "http://127.0.0.1:8888"); type("maxTokens", "99999"); click("Salvar");
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("4096"));
  expect(fixture.api).not.toHaveBeenCalled();
});
it("retains draft on failed save and preserves it across external config updates", async () => {
  fixture.api.mockRejectedValue(new Error("offline")); render(); type("url", "http://127.0.0.1:8890"); click("Salvar");
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("offline"));
  fixture.config = { memory: { hindsight: { enabled: true, url: "http://127.0.0.1:8899" } } }; render();
  expect(host.querySelector<HTMLInputElement>("#hindsight-url")!.value).toBe("http://127.0.0.1:8890");
});
it("tests a draft without saving or sending memory", async () => {
  fixture.api.mockResolvedValue({ ok: true, latencyMs: 7 }); render(); type("url", "http://127.0.0.1:8890"); click("Testar conexão");
  await vi.waitFor(() => expect(host.textContent).toContain("Conexão verificada (7 ms)"));
  expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/memory/hindsight/test", { method: "POST", body: JSON.stringify({ url: "http://127.0.0.1:8890" }) });
  expect(fixture.dispatch).not.toHaveBeenCalled();
  type("url", "http://127.0.0.1:8888"); expect(host.textContent).not.toContain("Conexão verificada");
});
it("saves the complete settings without overwriting memory upkeep", async () => {
  fixture.api.mockResolvedValue(fixture.config); render(); type("maxTokens", "512"); click("Salvar");
  await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalled());
  expect(JSON.parse(fixture.api.mock.calls[0][1].body)).toEqual({ memory: { hindsight: { mode: "external", enabled: false, url: "http://127.0.0.1:8888", recallTimeoutMs: 2000, retainTimeoutMs: 30000, maxTokens: 512 } } });
});
it("does not offer mutations on a Cloud home or an older server", () => {
  for (const config of [{ cloudHome: true }, {}]) {
    fixture.config = config; render();
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  }
});
it("uses bundled memory without requesting a service URL or sending a private key", async () => {
  fixture.config = { memory: { hindsight: { available: true, embeddedAvailable: true, mode: "embedded", enabled: true, runtimeState: "ready", error: null } } };
  fixture.api.mockResolvedValue({ ok: true, latencyMs: 4 }); render();
  expect(host.querySelector("#hindsight-url")).toBeNull();
  expect(host.textContent).toContain("Não precisa de Docker");
  click("Testar conexão");
  await vi.waitFor(() => expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/memory/hindsight/test", { method: "POST", body: JSON.stringify({ mode: "embedded" }) }));
});

it("asks to save before testing an unsaved switch from an external service to bundled memory", async () => {
  fixture.config = { memory: { hindsight: { available: true, embeddedAvailable: true, mode: "external", enabled: true, indexedDocuments: 2 } } };
  render();
  const mode = host.querySelector<HTMLSelectElement>("#hindsight-mode")!;
  mode.value = "embedded";
  flushSync(() => mode.dispatchEvent(new Event("change", { bubbles: true })));
  click("Testar conexão");
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("salve"));
  expect(fixture.api).not.toHaveBeenCalled();
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "Salvar")?.disabled).toBe(false);
});
