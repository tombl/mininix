import { isWritableStore, type Store } from "./mod.ts";

export function createHttpHandler(
  store: Store,
  priority: number,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const { pathname } = new URL(request.url, "http://host.invalid");
    console.debug(request.method, pathname);

    if (
      !(request.method === "GET" || request.method === "HEAD" ||
        (isWritableStore(store) && request.method === "PUT"))
    ) {
      return new Response("method not allowed", { status: 405 });
    }

    // TODO: support PUT properly

    if (pathname === "/nix-cache-info") {
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
      let info;
      try {
        info = await store.getInfo(hash);
      } catch {
        return new Response("nar not found", { status: 404 });
      }
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
      return new Response(JSON.stringify(listing), {
        headers: { "content-type": "application/json" },
      });
    }

    if (pathname.startsWith("/nar/")) {
      let nar;
      try {
        nar = await store.getNar({ narPathname: pathname.slice(1) });
      } catch {
        return new Response("nar not found", { status: 404 });
      }
      return new Response(nar, {
        headers: { "content-type": "application/x-nix-nar" },
      });
    }

    return null;
  };
}
