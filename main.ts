#!/usr/bin/env -S deno run -A
import { parseArgs } from "@std/cli";
import { join } from "@std/path";
import { SuperConsole } from "https://raw.githubusercontent.com/tombl/superconsole/9bac929/mod.ts";
import Database from "libsql";
import Queue from "p-queue";
import { createDecompressionStream } from "./compression.ts";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import type { NarInfo } from "./narinfo.ts";
import { BinaryCache, MultiStore } from "./store/mod.ts";
import { splitOnce } from "./util.ts";

const DB_PATH = "x86_64-linux-unstable.db";
const DB_URL =
  "https://github.com/tombl/nixpkgs-preeval/releases/download/2025-01-26/x86_64-linux-unstable.db.zst";

if (!(await Deno.stat(DB_PATH).then((f) => f.isFile, () => false))) {
  const res = await fetch(DB_URL);
  await Deno.writeFile(
    DB_PATH,
    res.body!.pipeThrough(createDecompressionStream("zstd")),
  );
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const keychain = new Keychain();
await keychain.trust(NIXOS_KEY);

const HELP = `Usage: mininix [options] <package>...

Options:
  -h, --help             Show this help message and exit
  --store-dir <dir>      Directory to install packages to (default: /nix/store)
  --substituter <url>... Additional binary cache URLs to use
`;

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  collect: ["substituter"],
  string: ["store-dir"],
  default: { "store-dir": "/nix/store", substituter: [] },
  alias: { h: "help" },
  unknown(arg) {
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      Deno.exit(1);
    }
  },
});

if (args.help) {
  console.log(HELP);
  Deno.exit(0);
}

const requestedPackages = db
  .prepare("select name, hash, full_name from packages where name = ?")
  .all(args._) as Array<{ name: string; hash: string; full_name: string }>;

if (requestedPackages.length !== args._.length) {
  const missing = args._.filter((name) =>
    !requestedPackages.some((p) => p.name === name)
  );
  console.error(`Unknown packages: ${missing.join(", ")}`);
  Deno.exit(1);
}

async function extract(
  storeDir: string,
  info: NarInfo,
  signal?: AbortSignal,
  onProgress?: (current: number, total: number) => void,
): Promise<boolean> {
  const stat = await Deno.lstat(storeDir).catch(() => null);
  if (stat?.isDirectory) return false;

  const sig = await info.verify(keychain);
  if (!sig.valid) {
    throw new Error("Invalid signature");
  }

  const created: Array<{ path: string; mode?: number }> = [];

  try {
    for await (const entry of await info.files({ signal, onProgress })) {
      signal?.throwIfAborted();
      const path = join(storeDir, entry.path);
      switch (entry.type) {
        case "regular":
          await Deno.writeFile(path, entry.body, { signal });
          created.push({ path, mode: entry.executable ? 0o555 : 0o444 });
          break;
        case "symlink":
          await Deno.symlink(entry.target, path);
          created.push({ path });
          break;
        case "directory":
          await Deno.mkdir(path, { recursive: true });
          created.push({ path, mode: 0o555 });
          break;
      }
    }

    for (const { path, mode } of created) {
      if (mode !== undefined) await Deno.chmod(path, mode);
    }
  } catch (error) {
    for (const { path, mode } of created.reverse()) {
      if (mode !== undefined) await Deno.chmod(path, mode & 0o200);
      await Deno.remove(path);
    }
    throw error;
  }

  return true;
}

const stores = await Promise.all(
  ["https://cache.nixos.org", ...args.substituter].map((url) =>
    BinaryCache.open(new URL(String(url)))
  ),
);

const cache = new MultiStore({ stores });

const controller = new AbortController();
Deno.addSignalListener("SIGINT", () => controller.abort());
const { signal } = controller;

const c = new SuperConsole();
signal.addEventListener("abort", () => c[Symbol.asyncDispose]());
const bars: Array<{ name: string; current: number; total: number } | null> = [];

function drawBar(progress: number, width: number) {
  const SYMBOLS = " ▏▎▍▌▋▊▉█";

  const filled = Math.floor(progress * width);
  const partial = Math.floor((progress * width) % 1 * SYMBOLS.length);
  const remainder = width - filled;

  return (
    SYMBOLS[SYMBOLS.length - 1].repeat(filled) +
    SYMBOLS[partial] +
    SYMBOLS[0].repeat(remainder)
  ).slice(0, width);
}

function render() {
  c.status = bars.filter((b) => b !== null).map((bar) => {
    const progress = bar.current / bar.total;

    return [
      `[${drawBar(progress, 50)}]`,
      `${(progress * 100).toFixed(0).padStart(3, " ")}%`,
      bar.name,
    ].join(" ");
  }).join("\n");
}

const queue = new Queue({
  concurrency: stores.every((s) =>
      s.wantMassQuery || s.url.protocol === "file:"
    )
    ? 8
    : 2,
});

const seen = new Set<string>();

async function traverse(fullName: string) {
  const [hash, name] = splitOnce(fullName, "-");
  if (seen.has(hash)) return;
  seen.add(hash);

  const info = await queue.add(
    ({ signal }) => cache.getInfo(hash, { signal }),
    { signal, priority: 2, throwOnTimeout: true },
  );
  for (const ref of info.references) traverse(ref);

  await queue.add(
    async ({ signal }) => {
      let i = bars.indexOf(null);
      if (i === -1) i = bars.length;

      const bar = bars[i] = {
        name,
        current: 0,
        total: Infinity,
      };

      const changed = await extract(
        info.storePath.replace(info.store.storeDir, args["store-dir"]),
        info,
        signal,
        (current, total) => {
          bar.current = current;
          bar.total = total;
          render();
        },
      );

      bars[i] = null;
      if (changed) c.log(`Installed ${name}`);
      render();
    },
    { signal, priority: 1 },
  );
}

for (const { hash, full_name } of requestedPackages) {
  traverse(`${hash}-${full_name}`);
}
