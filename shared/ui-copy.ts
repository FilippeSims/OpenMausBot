type CopyParams = Record<string, string | number>;
type CopyResolver = (source: string, params?: CopyParams) => string;
let resolver: CopyResolver | undefined;

/** Renderer installs its locale resolver; shared server helpers keep their English contract. */
export function setUiCopyResolver(value: CopyResolver): void {
  resolver = value;
}

export function uiCopy(source: string, params?: CopyParams): string {
  return resolver ? resolver(source, params) : source.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : match);
}
