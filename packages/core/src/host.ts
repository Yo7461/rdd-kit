/**
 * Everything the lint core reads from outside itself: the files under roadmap/, the config beside it,
 * whether a referenced path exists, and the git commands. The core has no I/O of its own — a caller
 * hands it a Host, so the same engine runs on Node (the CLI, the tests) and inside Claude Code's
 * hooks-module environment (the plugin's mod, which has no Node and reaches the machine through the
 * engine's own `$.fs` and `$.process`).
 *
 * Every method is asynchronous, and the core only ever reads: nothing here writes a file or changes
 * the repository.
 */

/** What a path leads to. `other` is anything that is neither a regular file nor a directory (a symbolic link, a device) — the core neither follows nor counts it. */
export type HostKind = 'file' | 'dir' | 'other';

/** One entry of a directory listing. */
export interface HostEntry {
  name: string;
  kind: HostKind;
}

export interface HostStat {
  kind: HostKind;
}

/** What a command came back with. The exit code is reported as it is — a non-zero exit is not an error here. */
export interface HostRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Host {
  /** The text of a file (UTF-8). Rejects when the file cannot be read */
  readText(file: string): Promise<string>;
  /** Whether a path exists (a file, a directory, or anything else) */
  exists(path: string): Promise<boolean>;
  /** The entries of one directory, not recursive */
  listDir(dir: string): Promise<HostEntry[]>;
  /** What a path leads to (symbolic links followed), or null when there is nothing there */
  stat(path: string): Promise<HostStat | null>;
  /** Runs a command by its argument vector (no shell) and resolves whatever its exit code. Rejects only when the command cannot start or does not finish */
  run(argv: readonly string[]): Promise<HostRunResult>;
}
