import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function getDataDirectory(): string {
  const directory = resolve(process.env.RIVERMIND_DATA_DIR || resolve(process.cwd(), "data"));
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function getDatabasePath(): string {
  const path = process.env.RIVERMIND_DATABASE_PATH ? resolve(process.env.RIVERMIND_DATABASE_PATH) : resolve(getDataDirectory(), "rivermind.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function getBackupDirectory(): string {
  const directory = resolve(process.env.RIVERMIND_BACKUP_DIR || resolve(getDataDirectory(), "backups"));
  mkdirSync(directory, { recursive: true });
  return directory;
}
