#!/usr/bin/env -S deno run -A
import { join } from "@std/path";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { BinaryCache, MultiStore } from "./store.ts";

const keychain = new Keychain();
await keychain.trust(NIXOS_KEY);

const out = Deno.args[0] ?? "./out";

const cache = new MultiStore({
  stores: [
    await BinaryCache.open(new URL("file:///home/tom/tmp/binary-cache")),
    await BinaryCache.open(new URL("https://cache.nixos.org")),
  ],
});
const info = await cache.get("a7hnr9dcmx3qkkn8a20g7md1wya5zc9l");

console.log(info);

if (!(await info.verify(keychain)).valid) {
  throw new Error("Invalid signature");
}

for await (const entry of await info.files()) {
  const path = join(out, entry.path);
  console.log(`${entry.type} ${path}`);
  switch (entry.type) {
    case "regular":
      await Deno.writeFile(path, entry.body, {
        mode: entry.executable ? 0o755 : 0o644,
      });
      break;
    case "symlink":
      await Deno.symlink(entry.target, path);
      break;
    case "directory":
      await Deno.mkdir(path);
      break;
  }
}
