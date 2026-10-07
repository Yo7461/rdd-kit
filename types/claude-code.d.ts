/**
 * The part of Claude Code's hooks-module API that this plugin's module (plugin/hooks/register.ts)
 * uses, declared by hand so that the module — and the copy of the core it imports — type-check in
 * this repository (tsconfig.plugin.json, run by `pnpm run typecheck`). The engine itself writes the
 * whole declaration, some 18,000 lines, beside a plugin it loads from a folder of the person's own
 * (.claude-plugin/types/claude-code/index.d.ts) and through `/plugin-types`; this subset was written
 * against the declaration of Claude Code 2.1.286, keeps its names and shapes, and is where a change
 * of the engine's API shows up first. At run time the import is empty: the engine hands the module
 * `on` and `$`.
 */
declare module 'claude-code' {
  /** A plugin's options as `register(on, options)` receives them. */
  export type PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>;

  /** The hooks module's entry: `export const register: Register = (on, options) => { ... }`. */
  export type Register = (on: On, options: PluginOptions) => unknown;

  /**
   * A hook: `$` is the engine interface, `e` the event's input (frozen), and `next(e)` runs the
   * plugins beneath and then the engine's own behaviour, resolving to the event's result. A hook that
   * returns without `next` answers for itself; `next({ ...e, x })` rewrites what the rest sees.
   */
  export type Hook<E, R> = ($: EngineInterface, e: Readonly<E>, next: (e: E) => Promise<R>) => R | Promise<R>;

  /** `on(event, matcher?, hook)` adds a hook. The forms this plugin's module uses. */
  export interface On {
    (event: 'tool.call', matcher: { readonly tool: readonly FileToolName[] }, hook: Hook<FileToolCallInput, ToolCallResult>): unknown;
    (event: 'tool.call', matcher: { readonly tool: McpToolName }, hook: Hook<McpToolCallInput, ToolCallResult>): unknown;
    (event: 'session.append', matcher: { readonly door: SessionAppendDoor }, hook: Hook<SessionAppendInput, SessionAppendResult>): unknown;
    (event: 'session.start', hook: Hook<SessionStartInput, SessionStartResult>): unknown;
  }

  /** The engine interface: each call spelled noun then method. The nouns and methods this module uses. */
  export interface EngineInterface {
    readonly session: {
      /** Returns the directory the session runs in, absolute. */
      cwd(): Promise<string>;
    };
    /** The file system as the engine's own process reaches it; a relative path is under the session's working directory. */
    readonly fs: {
      /** Reads a file and returns its text (UTF-8). Rejects when missing, or over 4 MiB. */
      read(path: string): Promise<string>;
      /** Lists a directory by name, each entry as it stands; absent, the working directory. */
      list(path?: string): Promise<FsEntry[]>;
      /** Returns whether the path exists. */
      exists(path: string): Promise<boolean>;
      /** Returns what the path leads to (a link followed). Rejects when missing. */
      stat(path: string, options?: FsStatOptions): Promise<FsStat>;
    };
    /** Commands on the host, run as the user the session runs as. */
    readonly process: {
      /** Runs a command by its argument vector (no shell) and resolves once it exits, any exit code. Rejects when it cannot start or is still running at the timeout. */
      run(argv: readonly string[], init?: ProcessRunInit): Promise<ProcessRunResult>;
    };
    readonly ui: {
      /** Shows `text` as one dim line of the transcript (and in the debug log). */
      log(text: string, options?: UiLogOptions): void;
    };
    readonly tool: {
      /** Declares a tool the model can call, listed as `mcp__<plugin>__<name>`; served by a `tool.call` hook on that name. Rejects until the session binds, at `session.start`. */
      register(tool: ToolSpec): Promise<{ tool: string }>;
    };
  }

  // ---- tool.call ---------------------------------------------------------------------------------------

  export type FileToolName = 'Edit' | 'Write';

  /** The input of `tool.call` for the two file tools: the tool, the id of this call, and the tool's arguments beside them. */
  export type FileToolCallInput =
    | { tool: 'Edit'; tool_use_id: string; file_path: string; old_string: string; new_string: string; replace_all?: boolean; agentId?: string }
    | { tool: 'Write'; tool_use_id: string; file_path: string; content: string; agentId?: string };

  /** The name of an MCP tool as the engine spells it — a registered tool is `mcp__<plugin>__<name>`. */
  export type McpToolName = `mcp__${string}__${string}`;

  /** The input of `tool.call` for an MCP tool whose arguments are not declared: the name, the id, and loose arguments. */
  export type McpToolCallInput = {
    tool: McpToolName;
    tool_use_id: string;
    agentId?: string;
    [argument: string]: unknown;
  };

  /**
   * What a `tool.call` hook returns and what `next(e)` resolves to: the tool's result (`{ result, context? }`)
   * or `{ deny }`. From core the result carries `ref` and `text`, and `isError` when the tool reported an error.
   */
  export type ToolCallResult =
    | {
        /** Refuses the call: the model receives the text as an error result. */
        deny: string;
        result?: undefined;
        context?: undefined;
        ref?: undefined;
        text?: undefined;
        isError?: undefined;
        isReadOnly?: undefined;
      }
    | {
        /** The tool's output: from core the tool's record, from a hook its own. */
        result: unknown;
        /** What the model reads after the tool's result and the user never sees. */
        context?: readonly string[];
        ref?: number;
        /** Set by core: the result as the model reads it. */
        text?: string;
        isReadOnly?: true;
        isError?: undefined;
        deny?: undefined;
      }
    | {
        /** Set by core, present only when the tool reported an error. */
        isError: true;
        result: unknown;
        text?: string;
        ref?: number;
        context?: readonly string[];
        isReadOnly?: true;
        deny?: undefined;
      };

  /** The argument of `$.tool.register(spec)`. */
  export type ToolSpec = {
    /** The tool's short name (letters, digits, `_`, `-`; up to 64); the model calls it as `mcp__<plugin>__<name>`. */
    name: string;
    /** What the tool does, for the model. */
    description: string;
    /** A JSON schema object for the input; default `{ type: "object" }`. */
    inputSchema?: Record<string, unknown>;
  };

  // ---- session.append ----------------------------------------------------------------------------------

  /** Which door a row came in by. */
  export type SessionAppendDoor =
    | 'prompt'
    | 'command'
    | 'response'
    | 'tool-result'
    | 'tool-message'
    | 'delivery'
    | 'attachment'
    | 'hook-context'
    | 'note'
    | 'compaction'
    | 'notice';

  /** One block of a message, as the Messages API spells it: the kind, and that kind's fields. */
  export type ApiContentBlock = {
    type: string;
    [field: string]: unknown;
  };

  /** One row of a conversation as `session.append` hands it. All but `content` is pinned. */
  export type SessionAppendMessage = {
    type: 'user' | 'assistant' | 'attachment' | 'system';
    name?: string;
    role?: 'user' | 'assistant';
    isMeta?: true;
    /** The row's blocks in order. Rewritable: text blocks, and a tool_result's `content` and `is_error`. */
    content: ApiContentBlock[];
  };

  /** The input of `session.append`: one row being appended to a conversation. */
  export type SessionAppendInput = {
    message: SessionAppendMessage;
    door: SessionAppendDoor;
    /** Who caused the row (the person, the model, a tool, the engine, a settings hook, a plugin). Pinned. */
    origin: { readonly kind: string; readonly [field: string]: unknown };
    uuid: string;
    agentId?: string;
  };

  /** What a `session.append` hook returns and what `next(e)` resolves to: the row as stored, or `{ deny }` for a plugin's own call. */
  export type SessionAppendResult =
    | { message: SessionAppendMessage; uuid: string; deny?: undefined }
    | { deny: string; message?: undefined; uuid?: undefined };

  // ---- session.start -----------------------------------------------------------------------------------

  export type SessionStartInput = {
    /** The directory the session runs in, absolute. */
    cwd: string;
    /** Where the session draws at start; null for a `-p` run or the SDK. */
    surface: string | null;
    /** Whether a person is at the prompt. */
    isInteractive: boolean;
  };

  export type SessionStartResult = {
    cwd: string;
  };

  // ---- the nouns' values -------------------------------------------------------------------------------

  export type FsEntry = {
    name: string;
    /** Of the entry itself: a symbolic link is `other`. */
    kind: 'file' | 'dir' | 'other';
    size: number;
    mtimeMs: number;
    isLink: boolean;
  };

  export type FsStat = {
    /** Of what the path leads to: a link is followed. */
    kind: 'file' | 'dir' | 'other';
    size: number;
    mtimeMs: number;
    isLink: boolean;
    realPath?: string;
  };

  export type FsStatOptions = {
    resolve: boolean;
  };

  export type ProcessRunInit = {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    /** 30 seconds when absent, ten minutes at most. */
    timeoutMs?: number;
  };

  export type ProcessRunResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    isStdoutTruncated: boolean;
    isStderrTruncated: boolean;
  };

  export type UiLogOptions = {
    /** Where the line goes: `transcript` (the default) or `debug`. */
    to?: 'transcript' | 'debug';
  };
}
