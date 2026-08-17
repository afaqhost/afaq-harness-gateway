import { spawn, type ChildProcess } from "node:child_process";

export interface SpawnOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function spawnChild(opts: SpawnOptions): ChildProcess {
  const env = opts.env
    ? { ...process.env, ...opts.env }
    : process.env;

  return spawn(opts.command, opts.args, {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
}
