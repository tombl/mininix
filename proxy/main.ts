#!/usr/bin/env -S deno run -A
import { assert } from "@std/assert/assert";
import { parseArgs } from "@std/cli";
import { sortBy } from "@std/collections/sort-by";
import { BinaryCache, MultiStore } from "../store.ts";
import { assertEquals } from "@std/assert/equals";

const args = parseArgs(Deno.args, {
  collect: ["upstream"],
  default: {
    port: 8080,
    upstream: ["https://cache.nixos.org"],
  },
  alias: {
    p: "port",
    u: "upstream",
  },
});

assert(typeof args.port === "number", "port must be a number");

const store = new MultiStore({
  stores: await Promise.all(
    args.upstream.map((url) => BinaryCache.open(new URL(String(url)))),
  ),
});

sortBy(
  store.stores,
  (store) => {
    assert(store instanceof BinaryCache);
    assertEquals(store.storeDir, "/nix/store");
    return Number(store.url.searchParams.get("priority") ?? store.priority);
  },
  { order: "asc" }, // lower priority is most wanted
);

// maps nar pathname -> store index
// saved when sending a narinfo response, deleted when sending a nar response
const associatedStores = new Map<string, number>();

Deno.serve(
  { port: args.port },
  async (request) => {
    const { signal } = request;
    const { pathname } = new URL(request.url, "http://host.invalid");
    console.log(pathname);

    if (pathname === "/nix-cache-info") {
      return new Response(
        [
          "StoreDir: /nix/store",
          "WantMassQuery: 1",
          "Priority: 10",
        ].join("\n"),
        { headers: { "content-type": "text/x-nix-cache-info" } },
      );
    }

    if (pathname.endsWith(".narinfo")) {
      const hash = pathname.slice(1, -".narinfo".length);
      const info = await store.get(hash, { signal });

      if (info.narURL.pathname.startsWith("/nar/")) {
        associatedStores.set(info.narURL.pathname, info.storeIndex);
      } else {
        console.warn(
          "Expected nar pathname to start with /nar/:",
          info.narURL.href,
        );
      }

      return new Response(info.raw, {
        headers: { "content-type": "text/plain" },
      });
    }

    if (pathname.startsWith("/nar/")) {
      const storeIndex = associatedStores.get(pathname);
      if (storeIndex !== undefined) {
        const upstream = store.stores[storeIndex];
        assert(upstream instanceof BinaryCache);
        const response = await fetch(new URL(pathname, upstream.url), request);

        // do something with the response

        return response.clone();
      }
    }

    // fallback path for unhandled requests: blindly proxy to the first upstream that responds
    console.warn("no handler for", pathname);
    let response = new Response("no stores configured", { status: 500 });

    for (const upstream of store.stores) {
      if (!(upstream instanceof BinaryCache)) continue;
      response = await fetch(new URL(pathname, upstream.url), request);
      if (!response.ok) continue;

      // do something with the response

      return response.clone();
    }

    return response;
  },
);
