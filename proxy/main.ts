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

const localCache = await FsCache.open("./cache");
store.stores.unshift(localCache);

Deno.serve(
  { port: args.port },
  async (request) => {
    const { pathname } = new URL(request.url, "http://host.invalid");
    console.debug(request.method, pathname);

    if (!(request.method === "GET" || request.method === "HEAD")) {
      // TODO: support PUT?
      return new Response("method not allowed", { status: 405 });
    }

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
      let info;
      try {
        info = await store.getInfo(hash);
      } catch {
        return new Response("nar not found", { status: 404 });
      }

      void localCache.putInfo(hash, info).catch(console.error);

      return new Response(info.raw, {
        headers: { "content-type": "text/x-nix-narinfo" },
      });
    }

    if (pathname.endsWith(".ls")) {
      const hash = pathname.slice(1, -".ls".length);
      let listing;
      try {
        listing = await store.getListing(hash);
      } catch {
        return new Response("listing not found", { status: 404 });
      }

      void localCache.putListing(hash, listing).catch(console.error);

      return new Response(JSON.stringify(listing), {
        headers: { "content-type": "application/json" },
      });
    }

    if (pathname.startsWith("/nar/")) {
      let response;
      try {
        response = await store.getNar({ narPathname: pathname.slice(1) });
      } catch (error) {
        console.error("nar not found", pathname, error);
        return new Response("nar not found", { status: 404 });
      }

      void localCache.putNar(pathname.slice(1), response.clone())
        .catch(console.error);

      return response;
    }

    if (pathname === "/") return new Response("mininix proxy");

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
