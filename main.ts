#!/usr/bin/env -S deno run -A
import { Database } from "@db/sqlite";
import { parseArgs } from "@std/cli";
import { join } from "@std/path";
import Queue from "p-queue";
import { createDecompressionStream } from "./compression.ts";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { NarInfo } from "./narinfo.ts";
import { BinaryCache, MultiStore } from "./store.ts";
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

const db = new Database(DB_PATH, { readonly: true, create: false });

const keychain = new Keychain();
await keychain.trust(NIXOS_KEY);

const HELP = `Usage: mininix [options] <package>...

Options:
  -h, --help             Show this help message and exit
  --store-dir <dir>      Directory to install packages to (default: ./out)
  --substituter <url>... Additional binary cache URLs to use
`;

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  collect: ["substituter"],
  string: ["store-dir"],
  default: { "store-dir": "./out", substituter: [] },
  alias: { h: "help" },
  unknown(arg) {
    console.error(`Unknown option: ${arg}\n`);
    console.log(HELP);
    Deno.exit(1);
  },
});

if (args.help) {
  console.log(HELP);
  Deno.exit(0);
}

const requestedPackages = db
  .sql`select name, hash, full_name from packages where name in (${args._})`;

if (requestedPackages.length !== args._.length) {
  const missing = args._.filter((name) =>
    !requestedPackages.some((p) => p.name === name)
  );
  console.error(`Unknown packages: ${missing.join(", ")}`);
  Deno.exit(1);
}

async function extract(storeDir: string, info: NarInfo, signal?: AbortSignal) {
  const stat = await Deno.lstat(storeDir).catch(() => null);
  if (stat?.isDirectory) return;

  const sig = await info.verify(keychain);
  if (!sig.valid) {
    throw new Error("Invalid signature");
  }

  try {
    for await (const entry of await info.files()) {
      signal?.throwIfAborted();
      const path = join(storeDir, entry.path);
      switch (entry.type) {
        case "regular":
          await Deno.writeFile(path, entry.body, {
            mode: entry.executable ? 0o755 : 0o644,
            signal,
          });
          break;
        case "symlink":
          await Deno.symlink(entry.target, path);
          break;
        case "directory":
          await Deno.mkdir(path, { recursive: true });
          break;
      }
    }
  } catch (error) {
    await Deno.remove(storeDir, { recursive: true });
    throw error;
  }
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

const queue = new Queue({
  concurrency: stores.every((s) =>
      s.wantMassQuery || s.url.protocol === "file:"
    )
    ? 32
    : 4,
});

const seen = new Set<string>();

async function traverse(fullName: string) {
  const [hash, name] = splitOnce(fullName, "-");
  if (seen.has(hash)) return;
  seen.add(hash);

  const info = await cache.get(hash, { signal });
  for (const ref of info.references) {
    queue.add(() => traverse(ref), { signal, priority: 2 });
  }

  queue.add(
    async ({ signal }) => {
      console.log(`Installing ${name}`);
      await extract(
        info.storePath.replace(info.storeDir, args["store-dir"]),
        info,
        signal,
      );
      console.log(`Installed ${name}`);
    },
    { signal, priority: 1 },
  );
}

for (const { hash, full_name } of requestedPackages) {
  traverse(`${hash}-${full_name}`);
}

await queue.onIdle();
