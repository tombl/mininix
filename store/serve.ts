import { isNarListing } from "../nar.ts";
import { NarInfo } from "../narinfo.ts";
import { FsCache } from "./fs-cache.ts";
import { isWritableStore, type Store } from "./mod.ts";

export function createHttpHandler(
  store: Store,
  priority: number,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const { pathname } = new URL(request.url, "http://host.invalid");

    if (!["GET", "HEAD", "PUT"].includes(request.method)) {
      return new Response("method not allowed", { status: 405 });
    }

    if (pathname === "/nix-cache-info") {
      if (request.method === "PUT") {
        return new Response("method not allowed", { status: 405 });
      }

      return new Response(
        [
          `StoreDir: ${store.storeDir}`,
          "WantMassQuery: 1",
          `Priority: ${priority}`,
        ].join("\n"),
        { headers: { "content-type": "text/x-nix-cache-info" } },
      );
    }

    if (pathname.endsWith(".narinfo")) {
      const hash = pathname.slice(1, -".narinfo".length);

      if (request.method === "PUT") {
        if (!isWritableStore(store)) {
          return new Response("store is not writable", { status: 405 });
        }

        const raw = await request.text();
        let info;
        try {
          info = NarInfo.parse(raw, store, hash);
        } catch (error) {
          return new Response(
            `invalid narinfo: ${error}`,
            { status: 400 },
          );
        }

        return await store.putInfo(hash, info).then(
          () => new Response("ok", { status: 200 }),
          (error: unknown) => {
            console.error(error);
            return new Response(`failed to store: ${error}`, { status: 500 });
          },
        );
      }

      return await store.getInfo(hash).then(
        (info) =>
          new Response(info.raw, {
            headers: { "content-type": "text/x-nix-narinfo" },
          }),
        () => new Response("nar not found", { status: 404 }),
      );
    }

    if (pathname.endsWith(".ls")) {
      const hash = pathname.slice(1, -".ls".length);

      if (request.method === "PUT") {
        if (!isWritableStore(store)) {
          return new Response("store is not writable", { status: 405 });
        }

        const listing = await request.json();
        if (!isNarListing(listing)) {
          return new Response("invalid listing", { status: 400 });
        }

        return await store.putListing(hash, listing).then(
          () => new Response("ok", { status: 200 }),
          (error: unknown) => {
            console.error(error);
            return new Response(`failed to store: ${error}`, { status: 500 });
          },
        );
      }

      return await store.getListing(hash).then(
        (listing) =>
          new Response(JSON.stringify(listing), {
            headers: { "content-type": "application/json" },
          }),
        () => new Response("listing not found", { status: 404 }),
      );
    }

    if (pathname.startsWith("/nar/")) {
      const info = { narPathname: pathname.slice(1) };

      if (request.method === "PUT") {
        if (!isWritableStore(store)) {
          return new Response("store is not writable", { status: 405 });
        }

        return await store.putNar(info, request.body!).then(
          () => new Response("ok", { status: 200 }),
          (error: unknown) => {
            console.error(error);
            return new Response(`failed to store: ${error}`, { status: 500 });
          },
        );
      }

      return await store.getNar(info).then(
        (nar) =>
          new Response(nar, {
            headers: { "content-type": "application/x-nix-nar" },
          }),
        () => new Response("nar not found", { status: 404 }),
      );
    }

    return null;
  };
}

if (import.meta.main) {
  const store = await FsCache.open("cache");
  const handler = createHttpHandler(store, 1);
  Deno.serve(async (request) =>
    (await handler(request)) ?? new Response("not found", { status: 404 })
  );
}
