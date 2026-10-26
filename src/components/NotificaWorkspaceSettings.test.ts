// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificaWorkspaceStatus } from "../../shared/notifica";
import { setLocale } from "@/lib/i18n";
import { NotificaWorkspaceSettings } from "./NotificaWorkspaceSettings";

const fixture = vi.hoisted(() => ({ request: vi.fn(), owner: true }));
vi.mock("@/state/store", () => ({ api: fixture.request, useStore: () => ({dispatch:vi.fn()}) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));

let host: HTMLDivElement;
let root: Root;
const initial: NotificaWorkspaceStatus = {
  configured: false, enabled: false, authFailed: false, bots: 3, pending: 0,
  companies: [{ id: "company-a", name: "Acme" }, { id: "company-b", name: "Beta" }],
  teamCompanies: { Marketing: "company-a", Engineering: "company-b" },
  teams: [
    { id: "team-marketing", name: "Marketing", section: "Marketing", companyId: "company-a" },
    { id: "team-engineering", name: "Engineering", section: "Engineering", companyId: "company-b" },
  ],
};
const render = () => flushSync(() => root.render(createElement(NotificaWorkspaceSettings)));
const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === text)!;
const password = () => host.querySelector<HTMLInputElement>('input[type="password"]')!;
const type = (input: HTMLInputElement, value: string) => flushSync(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const select = (input: HTMLSelectElement, value: string) => flushSync(() => {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
const click = (element: HTMLButtonElement) => flushSync(() => element.click());
const loaded = () => vi.waitFor(() => expect(password().disabled).toBe(false));
const saveBody = () => {
  const writes = fixture.request.mock.calls.filter(([, init]) => init?.method === "PUT");
  return JSON.parse(writes.at(-1)![1].body);
};

beforeEach(() => {
  fixture.request.mockReset(); fixture.owner = true; setLocale("pt-br");
  fixture.request.mockResolvedValue(structuredClone(initial));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); setLocale("en"); });

it("writes a private connection key, preserves team assignments, and omits the key when disabling", async () => {
  render(); await loaded();
  expect(password().autocomplete).toBe("new-password");
  expect(password().closest("label")?.textContent).toContain("Chave privada");
  expect(button("Salvar conexão").disabled).toBe(true);
  type(password(), "fixture-private-key");
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-label")).toBeTruthy();
  click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fixture.request.mockResolvedValue({ ...initial, configured: true, enabled: true });
  click(button("Salvar conexão"));
  await vi.waitFor(() => expect(host.textContent).toContain("Conexão salva."));
  expect(saveBody()).toEqual({ enabled: true, companies: initial.companies, teamCompanies: initial.teamCompanies, key: "fixture-private-key" });
  expect(password().value).toBe("");
  expect(host.innerHTML).not.toContain("fixture-private-key");
  click(toggle);
  click(button("Salvar conexão"));
  await vi.waitFor(() => expect(saveBody()).toEqual({ enabled: false, companies: initial.companies, teamCompanies: initial.teamCompanies }));
});

it("keeps an unassigned team separate from a named team called Sem time", async () => {
  fixture.request.mockResolvedValue({ ...initial, configured: true, teamCompanies: { "": "company-a", "Sem time": "company-b" }, teams: [
    { id: "team-unassigned", name: "Sem time", section: "", companyId: "company-a" },
    { id: "team-named", name: "Sem time", section: "Sem time", companyId: "company-b" },
  ] });
  render(); await loaded();
  const selectors = [...host.querySelectorAll("select")];
  expect(selectors.map(input => input.value)).toEqual(["company-a", "company-b"]);
  select(selectors[0], "company-b");
  select(selectors[1], "company-a");
  click(button("Salvar conexão"));
  await vi.waitFor(() => expect(saveBody().teamCompanies).toEqual({ "": "company-b", "Sem time": "company-a" }));
});

it("reassigns a removed company's teams before saving and keeps at least one company", async () => {
  fixture.request.mockResolvedValue({ ...initial, configured: true });
  render(); await loaded();
  click(host.querySelector<HTMLButtonElement>('[aria-label="Remover empresa Beta"]')!);
  expect([...host.querySelectorAll("select")].map(input => input.value)).toEqual(["company-a", "company-a"]);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Remover empresa Acme"]')!.disabled).toBe(true);
  click(button("Salvar conexão"));
  await vi.waitFor(() => expect(saveBody()).toEqual({ enabled: false, companies: [initial.companies[0]], teamCompanies: { Marketing: "company-a", Engineering: "company-a" } }));
});

it("enforces company name and count limits and retains failed edits for retry", async () => {
  fixture.request.mockResolvedValue({ ...initial, configured: true, companies: Array.from({ length: 30 }, (_, index) => ({ id: `company-${index}`, name: `Company ${index}` })), teamCompanies: {}, teams: [] });
  render(); await loaded();
  expect(button("Empresa").disabled).toBe(true);
  const name = host.querySelector<HTMLInputElement>('[aria-label="Nome da empresa 1"]')!;
  expect(name.maxLength).toBe(120);
  type(name, "  ");
  expect(button("Salvar conexão").disabled).toBe(true);
  type(name, "New company name");
  type(password(), "unsaved-key");
  fixture.request.mockRejectedValue(new Error("Conexão indisponível"));
  click(button("Salvar conexão"));
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("Conexão indisponível"));
  expect(name.value).toBe("New company name");
  expect(password().value).toBe("unsaved-key");
  expect(host.textContent).not.toContain("Conexão salva.");
});

it("recovers from a failed initial read through Atualizar status", async () => {
  fixture.request.mockRejectedValueOnce(new Error("Unavailable"));
  render();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("carregar"));
  expect(password().disabled).toBe(true);
  click(button("Atualizar status"));
  await loaded();
  expect([...host.querySelectorAll("select")].map(input => input.value)).toEqual(["company-a", "company-b"]);
});

it("does not render the private workspace editor or request its settings for a non-admin", () => {
  fixture.owner = false; render();
  expect(host.textContent).toBe("");
  expect(fixture.request).not.toHaveBeenCalled();
});
