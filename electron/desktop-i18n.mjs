import en from "../src/locales/en.json" with { type: "json" };
import ptBr from "../src/locales/pt-br.json" with { type: "json" };

const keys = new Map(Object.entries(en).map(([key, value]) => [value, key]));
let language = "en";

export function setDesktopLanguage(tag) {
  language = typeof tag === "string" && /^pt(?:-|$)/i.test(tag) ? "pt-BR" : "en";
  return language;
}

export function desktopLanguage() {
  return language;
}

export function desktopText(source, params = {}) {
  const template = language === "pt-BR" ? ptBr[keys.get(source)] ?? source : source;
  return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
