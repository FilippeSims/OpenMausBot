import { ApiError } from "@/state/api";
import { t } from "./i18n";

export const OPEN_TEAM_FILES = "omb:open-team-files";
export function openTeamFiles(section: string): void { window.dispatchEvent(new CustomEvent(OPEN_TEAM_FILES, { detail: { section } })); }

export function teamFileUrl(section: string, path = "", content = false): string {
  return `/api/team-files${content ? "/content" : ""}?${new URLSearchParams({ section, path })}`;
}

export function teamFilesProblem(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : 0;
  if (status === 409) return t("teamFiles.conflict");
  if (status === 413) return t("teamFiles.tooLarge");
  if (status === 403) return t("teamFiles.denied");
  if (status === 404) return t("teamFiles.notFound");
  if (status === 400) return t("teamFiles.invalidPath");
  return t("teamFiles.failed");
}

export async function teamFileBlob(section: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(teamFileUrl(section, path, true), { signal });
  if (!response.ok) throw new ApiError("Team file request failed", response.status);
  return response.blob();
}

export async function downloadTeamFile(section: string, path: string): Promise<void> {
  const blob = await teamFileBlob(section, path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = path.split("/").at(-1) || "file";
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
