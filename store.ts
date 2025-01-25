import { NarListing } from "./nar.ts";
import { NarInfo } from "./narinfo.ts";
import { Data, parseKeyValue } from "./util.ts";

export interface Store {
  get(hash: string, options?: { signal?: AbortSignal }): Promise<NarInfo>;
}

export class BinaryCache extends Data<{
  url: URL;
  storeDir: string;
  wantMassQuery: boolean;
  priority: number;
}> implements Store {
  static async open(url: URL) {
    if (!url.pathname.endsWith("/")) url = new URL(url.href + "/");
    const response = await fetch(new URL("nix-cache-info", url));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const data = parseKeyValue(await response.text(), ": ");
    return new BinaryCache({
      url,
      storeDir: data.StoreDir,
      wantMassQuery: data.WantMassQuery === "1",
      priority: parseInt(data.Priority ?? "0"),
    });
  }

  #fetch(path: string, init?: RequestInit) {
    return fetch(new URL(path, this.url), init);
  }

  async get(hash: string, { signal }: { signal?: AbortSignal } = {}) {
    const response = await this.#fetch(hash + ".narinfo", { signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const text = await response.text();

    const listingResponse = await this.#fetch(hash + ".ls", { signal });
    if (!listingResponse.ok) {
      throw new Error(
        `${listingResponse.status} ${listingResponse.statusText}`,
      );
    }
    const listing: NarListing = await listingResponse.json();

    return NarInfo.parse(text, this, listing);
  }
}

export class MultiStore extends Data<{ stores: Store[] }> implements Store {
  async get(hash: string, options?: { signal?: AbortSignal }) {
    let error;
    for (const store of this.stores) {
      try {
        return await store.get(hash, options);
      } catch (e) {
        error = e;
      }
    }
    throw error;
  }
}
