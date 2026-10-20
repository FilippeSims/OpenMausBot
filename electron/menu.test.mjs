import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { name: "OpenMausBot" },
  Menu: { buildFromTemplate: (template) => template },
}));

import { buildApplicationMenu } from "./menu.mjs";
import { setDesktopLanguage } from "./desktop-i18n.mjs";

describe("buildApplicationMenu", () => {
  const originalPlatform = process.platform;

  function withPlatform(platform, fn) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  const environments = [{ id: "x", name: "X", origin: "http://localhost" }];
  const build = (platform, overrides = {}) =>
    withPlatform(platform, () =>
      buildApplicationMenu({
        environments,
        activeId: "x",
        onSwitch: vi.fn(),
        onAddFromClipboard: vi.fn(),
        onForget: vi.fn(),
        ...overrides,
      }),
    );

  it("macOS app menu wires an explicit Preferences item to the settings callback", () => {
    const onOpenSettings = vi.fn();
    const template = build("darwin", { onOpenSettings });
    const item = template[0].submenu.find((entry) => entry.label === "Preferences…");
    expect(item).toBeDefined();
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    expect(item.click).toBeTypeOf("function");
    item.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it.each(["linux", "win32"])("does not add an app menu on %s", (platform) => {
    const template = build(platform);
    expect(template[0].role).toBe("fileMenu");
    for (const item of template) {
      expect(item.label).not.toBe("OpenMausBot");
    }
  });

  it.each(["darwin", "linux", "win32"])("offers native organisation sign-in while a hosted workspace is active on %s", platform => {
    const onOrganizationSignIn = vi.fn();
    const template = build(platform, { onOrganizationSignIn });
    const item = template.find(entry => entry.label === "Server").submenu.find(entry => entry.id === "organization-sign-in");
    expect(item.label).toBe("Sign in with your organization…");
    item.click();
    expect(onOrganizationSignIn).toHaveBeenCalledOnce();
  });

  it("mirrors Add a Cloud… under the saved servers only when main offers it, and names My Cloud's line", () => {
    const servers = [{ id: "cloud", name: "My Cloud", origin: "https://omb-u-1.fly.dev" }];
    const without = build("darwin", { environments: servers }).find(entry => entry.label === "Server").submenu;
    expect(without.some(entry => entry.id === "add-cloud")).toBe(false);
    expect(without.find(entry => entry.type === "radio" && entry.label.startsWith("My Cloud")).label).toBe("My Cloud — omb-u-1.fly.dev");
    const onAddCloud = vi.fn();
    const submenu = build("darwin", { environments: servers, onAddCloud, sublabels: { cloud: "Always on" } }).find(entry => entry.label === "Server").submenu;
    expect(submenu.map(entry => entry.id ?? entry.label ?? entry.type).slice(0, 4)).toEqual(["This computer", "My Cloud — Always on", "add-cloud", "separator"]);
    submenu.find(entry => entry.id === "add-cloud").click();
    expect(onAddCloud).toHaveBeenCalledOnce();
    expect(submenu.find(entry => entry.id === "add-cloud").label).toBe("Add a Cloud…");
  });
});

it("uses Portuguese for native menus and returns to English without changing server identities", () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  try {
    setDesktopLanguage("pt-br");
    const onSwitch = vi.fn();
    const input = { environments: [{ id: "literal", name: "English Server Name", origin: "https://example.test" }], activeId: "literal", onSwitch, onOpenSettings: vi.fn() };
    const menu = buildApplicationMenu(input);
    const server = menu.find(item => item.label === "Servidor");
    expect(server).toBeDefined();
    expect(server.submenu[0].label).toBe("Este computador");
    expect(server.submenu[1].label).toContain("English Server Name");
    server.submenu[0].click();
    expect(onSwitch).toHaveBeenCalledExactlyOnceWith("local");
    expect(menu.find(item => item.role === "editMenu").label).toBe("Editar");
    expect(menu[0].submenu.find(item => item.role === "quit").label).toBe("Sair do OpenMausBot");
    setDesktopLanguage("en");
    expect(buildApplicationMenu(input).find(item => item.label === "Server")).toBeDefined();
  } finally {
    setDesktopLanguage("en");
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  }
});
