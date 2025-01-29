import { assertEquals } from "@std/assert/equals";
import type { NarListing } from "../nar.ts";
import type { NarInfo } from "../narinfo.ts";
import { Data } from "../util.ts";
import type { Store } from "./mod.ts";

export class MultiStore extends Data<{ stores: Store[] }> implements Store {
  get storeDir(): string {
    const [{ storeDir }] = this.stores;
    for (const store of this.stores) {
      assertEquals(store.storeDir, storeDir);
    }
    return storeDir;
  }

  #indexes = new WeakMap<object, number>();
  getIndex(object: object): number | undefined {
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
  ): Promise<ReadableStream<Uint8Array>> {
    const index = this.getIndex(info);
    if (index === undefined) {
      return this.#find((store) => store.getNar(info, options));
    } else {
      return this.stores[index].getNar(info, options);
    }
  }
}
