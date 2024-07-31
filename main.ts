#!/usr/bin/env -S deno run -A
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { BinaryCache } from "./store.ts";

const keychain = new Keychain();
await keychain.trust(NIXOS_KEY);

// const cache = await BinaryCache.create(new URL("https://cache.nixos.org"));
const cache = await BinaryCache.open(
  new URL("file:///home/tom/tmp/binary-cache"),
);
const info = await cache.narInfo("0n2d54ql7fw485p1181sz6v6j287p4fq");

console.log(info.fingerprint());

// console.log(await info.verify(keychain));

// const nar = await info.fetchNar();

// const bytes = await new Response(nar).arrayBuffer();
// console.log(bytes.byteLength)
