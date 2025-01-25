#!/usr/bin/env -S deno run -A
import { join } from "@std/path";
import Queue from "p-queue";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { NarInfo } from "./narinfo.ts";
import { BinaryCache, MultiStore } from "./store.ts";
import { splitOnce } from "./util.ts";

const keychain = new Keychain();
await keychain.trust(NIXOS_KEY);

const storeDir = Deno.args[0] ?? "./out";
const hash = Deno.args[1] ?? "a7hnr9dcmx3qkkn8a20g7md1wya5zc9l-hello"; // hello-2.12.1

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

const nixosCache = await BinaryCache.open(new URL("https://cache.nixos.org"));

const cache = new MultiStore({
  stores: [
    await BinaryCache.open(new URL("file:///home/tom/tmp/binary-cache")),
    nixosCache,
  ],
});

const controller = new AbortController();
Deno.addSignalListener("SIGINT", () => controller.abort());
const { signal } = controller;

const queue = new Queue({ concurrency: nixosCache.wantMassQuery ? 32 : 4 });

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
        info.storePath.replace(info.storeDir, storeDir),
        info,
        signal,
      );
      console.log(`Installed ${name}`);
    },
    { signal, priority: 1 },
  );
}

await traverse(hash);
await queue.onIdle();
