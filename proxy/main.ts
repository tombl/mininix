#!/usr/bin/env -S deno run -A
import { assert } from "@std/assert/assert";
import { parseArgs } from "@std/cli";
import { sortBy } from "@std/collections/sort-by";
import { BinaryCache, MultiStore } from "../store.ts";
import { assertEquals } from "@std/assert/equals";
import { FsCache } from "./cache.ts";

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

const localCache = new FsCache("./cache");
store.stores.unshift(localCache);

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
      const info = await store.getInfo(hash, { signal });

      if (info.narPathname.startsWith("nar/")) {
        const index = store.getIndex(info);
        assert(index !== undefined);
        associatedStores.set(info.narPathname, index);
      } else {
        console.warn(
          "Expected nar pathname to start with nar/, got",
          info.narPathname,
        );
      }

      void localCache.putInfo(hash, info);

      return new Response(info.raw, {
        headers: { "content-type": "text/x-nix-narinfo" },
      });
    }

    if (pathname.endsWith(".ls")) {
      const hash = pathname.slice(1, -".ls".length);
      const listing = await store.getListing(hash, { signal });

      void localCache.putListing(hash, listing);

      return new Response(JSON.stringify(listing), {
        headers: { "content-type": "application/json" },
      });
    }

    if (pathname.startsWith("/nar/")) {
      const storeIndex = associatedStores.get(pathname.slice(1));
      if (storeIndex !== undefined) {
        const upstream = store.stores[storeIndex];
        const response = await upstream.getNar(
          { narPathname: pathname },
          { signal },
        );

        void localCache.putNar(pathname, response.clone());

        return response;
      }
    }

    // fallback path for unhandled requests: blindly proxy to the first upstream that responds
    console.warn("no handler for", pathname);
    let response = new Response("no stores configured", { status: 500 });

    for (const upstream of store.stores) {
      if (!(upstream instanceof BinaryCache)) continue;
      response = await fetch(new URL(pathname, upstream.url), request);
      if (response.ok) break;
    }

    return response;
  },
);
