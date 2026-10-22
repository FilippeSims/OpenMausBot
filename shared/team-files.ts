export const TEAM_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const TEAM_FILES_MAX_BYTES = 2 * 1024 ** 3;
export const TEAM_FILES_MAX_ENTRIES = 10_000;
export const TEAM_REFERENCES_FOLDER = "Referências";
export const TEAM_OUTPUTS_FOLDER = "Entregas";

/** Paths are relative to one team's persistent directory, never host paths. */
export interface TeamFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  bytes: number;
  modifiedAt: number;
}

export interface TeamFilesListing {
  section: string;
  path: string;
  entries: TeamFileEntry[];
  total: number;
  root: string;
  maxFileBytes: number;
}

export interface TeamFileTrashEntry {
  id: string;
  path: string;
  removedAt: number;
}

export interface TeamFileReceipt {
  path: string;
  bytes: number;
  sha256: string;
}
