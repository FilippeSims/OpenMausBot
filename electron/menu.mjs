// Electron has no role for the macOS Preferences… item, so it is built explicitly.
import { Menu, app } from "electron";
import { desktopLanguage, desktopText } from "./desktop-i18n.mjs";

/**
 * @param {object} input
 * @param {{ id: string, name: string, origin: string }[]} input.environments
 * @param {string} input.activeId  "local" or an environment id
 * @param {(id: string) => void} input.onSwitch
 * @param {() => void} input.onAddFromClipboard
 * @param {() => void} input.onConnect
 * @param {(id: string) => void} input.onForget
 * @param {() => void} input.onOpenSettings
 * @param {() => void} input.onOrganizationSignIn
 */
export function buildApplicationMenu({ environments, activeId, onSwitch, onAddFromClipboard, onConnect, onForget, onOpenSettings, onOrganizationSignIn, onAddCloud, sublabels = {} }) {
  const isMac = process.platform === "darwin";
  const active = environments.find((e) => e.id === activeId) ?? null;
  const server = {
    label: "Server",
    submenu: [
      { label: "This computer", type: "radio", checked: !active, click: () => onSwitch("local") },
      ...environments.map((e) => ({
        label: `${e.name} — ${Object.hasOwn(sublabels, e.id) ? sublabels[e.id] : new URL(e.origin).host}`,
        type: "radio",
        checked: e.id === activeId,
        click: () => onSwitch(e.id),
      })),
      ...(onAddCloud ? [{ id: "add-cloud", label: "Add a Cloud…", click: () => onAddCloud() }] : []),
      { type: "separator" },
      { id: "organization-sign-in", label: "Sign in with your organization…", click: onOrganizationSignIn },
      { label: "Connect to a server…", click: onConnect },
      { label: "Add Server from Copied Pairing Link…", click: () => onAddFromClipboard() },
      {
        label: active ? desktopText("Forget “{name}”", { name: active.name }) : "Forget Server",
        enabled: Boolean(active),
        click: () => active && onForget(active.id),
      },
    ],
  };
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "about" }, { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    server,
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  if (desktopLanguage() === "pt-BR") {
    const roles = {
      about: "About OpenMausBot", hide: "Hide OpenMausBot", hideOthers: "Hide Others", unhide: "Show All", quit: "Quit OpenMausBot",
      fileMenu: "File", editMenu: "Edit", viewMenu: "View", windowMenu: "Window", close: "Close", undo: "Undo", redo: "Redo",
      cut: "Cut", copy: "Copy", paste: "Paste", pasteAndMatchStyle: "Paste and Match Style", delete: "Delete", selectAll: "Select All",
      reload: "Reload", forceReload: "Force Reload", toggleDevTools: "Developer Tools", resetZoom: "Actual Size", zoomIn: "Zoom In",
      zoomOut: "Zoom Out", togglefullscreen: "Toggle Full Screen", minimize: "Minimize", zoom: "Zoom", front: "Bring All to Front",
    };
    const menus = {
      fileMenu: ["close", ...(!isMac ? ["quit"] : [])],
      editMenu: ["undo", "redo", null, "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"],
      viewMenu: ["reload", "forceReload", "toggleDevTools", null, "resetZoom", "zoomIn", "zoomOut", null, "togglefullscreen"],
      windowMenu: ["minimize", "zoom", ...(isMac ? [null, "front"] : ["close"])],
    };
    const translate = (items) => items.forEach(item => {
      if (item.role && roles[item.role]) item.label = desktopText(roles[item.role]);
      else if (item.label) item.label = desktopText(item.label);
      if (menus[item.role]) item.submenu = menus[item.role].map(role => role ? { role } : { type: "separator" });
      if (Array.isArray(item.submenu)) translate(item.submenu);
    });
    translate(template);
  }
  return Menu.buildFromTemplate(template);
}
