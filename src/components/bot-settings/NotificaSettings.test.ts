// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotEditorContext } from "./BotEditorContext";
import { NotificaSettings } from "./NotificaSettings";

const fixture = vi.hoisted(() => ({ request: vi.fn(), owner: true }));
vi.mock("@/state/store", () => ({ api: fixture.request }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));
let host: HTMLDivElement;
let root: Root;
const empty = { configured: false, enabled: false, authFailed: false, pending: [] };
const render = (botId = "a", draft = false) => flushSync(() => root.render(createElement(BotEditorContext.Provider,
  { value: { request: fixture.request, draft } }, createElement(NotificaSettings, { botId }))));
const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
const input = () => host.querySelector<HTMLInputElement>('input[type="password"]')!;
const type = (text: string) => flushSync(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  fixture.request.mockReset(); fixture.owner = true; setLocale("pt-br");
  fixture.request.mockResolvedValue(empty);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); setLocale("en"); });

it("saves a write-only bot key through the private endpoint, clears the password, and preserves it when disabling", async () => {
  render(); await vi.waitFor(() => expect(input().disabled).toBe(false));
  expect(host.textContent).toContain("Agentes → Conectar agente");
  expect(input().type).toBe("password"); expect(input().autocomplete).toBe("new-password");
  type("secret-from-notifica"); flushSync(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  fixture.request.mockResolvedValue({ ...empty, configured: true, enabled: true });
  flushSync(() => button("Salvar Notifica").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Configuração do Notifica salva."));
  expect(fixture.request).toHaveBeenLastCalledWith("/api/bots/a/notifica", { method: "PUT", body: JSON.stringify({ enabled: true, key: "secret-from-notifica", replacePendingKey: false }) });
  expect(input().value).toBe(""); expect(host.innerHTML).not.toContain("secret-from-notifica");
  flushSync(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  flushSync(() => button("Salvar Notifica").click());
  await vi.waitFor(() => expect(fixture.request).toHaveBeenLastCalledWith("/api/bots/a/notifica", { method: "PUT", body: JSON.stringify({ enabled: false }) }));
});

it("does not let a late response or typed key from one bot populate another bot's editor", async () => {
  let finish!: (value: unknown) => void;
  fixture.request.mockImplementation((path: string) => path.includes("/a/") ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(empty));
  render("a"); render("b");
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  finish({ ...empty, configured: true, enabled: true }); await new Promise(resolve => setTimeout(resolve, 0));
  expect(input().placeholder).toBe("Cole a chave do Notifica");
  expect(host.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  type("key-for-b"); render("c");
  await vi.waitFor(() => expect(input().disabled).toBe(false)); expect(input().value).toBe("");
  expect(fixture.request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("keeps failed writes visible and does not claim a key was saved", async () => {
  render(); await vi.waitFor(() => expect(input().disabled).toBe(false)); type("unsaved-key");
  fixture.request.mockRejectedValue(new Error("network unavailable"));
  flushSync(() => button("Salvar Notifica").click());
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível"));
  expect(input().value).toBe("unsaved-key"); expect(host.textContent).not.toContain("Configuração do Notifica salva.");
});

it("does not request credentials for a draft or a non-admin viewer", () => {
  render("a", true); expect(host.textContent).toContain("Salve o bot"); expect(fixture.request).not.toHaveBeenCalled();
  fixture.owner = false; render("b"); expect(host.textContent).toBe(""); expect(fixture.request).not.toHaveBeenCalled();
});
