import { assertEquals } from "@std/assert/equals";
import { isNarListing, NarListing } from "./nar.ts";
import { NarInfo } from "./narinfo.ts";
import { Data, parseKeyValue } from "./util.ts";

export interface Store {
  storeDir: string;

  getInfo(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarInfo>;

  getListing(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarListing>;

  getNar(
    info: { narPathname: string },
    options?: { signal?: AbortSignal },
  ): Promise<Response>;
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
      throw new Error(
        `${response.status} ${response.statusText} at ${url}/nix-cache-info`,
      );
    }
    const data = parseKeyValue(await response.text(), ": ");
    return new BinaryCache({
      url,
      storeDir: data.StoreDir,
      wantMassQuery: data.WantMassQuery === "1",
      priority: parseInt(data.Priority ?? "0"),
    });
  }

  async #fetch(path: string, init?: RequestInit) {
    const url = new URL(path, this.url);
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} at ${url}`);
    }
    return response;
  }

  async getInfo(hash: string, options?: { signal?: AbortSignal }) {
    const response = await this.#fetch(hash + ".narinfo", options);
    return NarInfo.parse(await response.text(), this, hash);
  }

  async getListing(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarListing> {
    const response = await this.#fetch(hash + ".ls", options);
    const json: unknown = await response.json();
    if (!isNarListing(json)) throw new Error("invalid nar listing");
    return json;
  }

  getNar(
    info: { narPathname: string },
    options: { signal?: AbortSignal } = {},
  ) {
    return this.#fetch(info.narPathname, options);
  }
}

export class MultiStore extends Data<{ stores: Store[] }> implements Store {
  get storeDir() {
    const [{ storeDir }] = this.stores;
    for (const store of this.stores) {
      assertEquals(store.storeDir, storeDir);
    }
    return storeDir;
  }

  #indexes = new WeakMap<object, number>();
  getIndex(object: object) {
    return this.#indexes.get(object);
  }

  hits: number[] = [];
  misses = 0;
  async #find<T extends object>(fn: (store: Store) => Promise<T>): Promise<T> {
    const errors = [];
    for (let i = 0; i < this.stores.length; i++) {
      const store = this.stores[i];
      try {
        const value = await fn(store);
        this.#indexes.set(value, i);
        this.hits[i] ??= 0;
        this.hits[i]++;
        return value;
      } catch (error) {
        errors.push(error);
      }
    }
    this.misses++;
    throw new AggregateError(errors, "all stores failed");
  }

  getInfo(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarInfo> {
    return this.#find((store) => store.getInfo(hash, options));
  }

  getListing(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarListing> {
    return this.#find((store) => store.getListing(hash, options));
  }

  getNar(
    info: { narPathname: string },
    options?: { signal?: AbortSignal },
  ): Promise<Response> {
    const index = this.getIndex(info);
    if (index === undefined) {
      return this.#find((store) => store.getNar(info, options));
    } else {
      return this.stores[index].getNar(info, options);
    }
  }
}
