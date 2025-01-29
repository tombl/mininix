import type { NarListing } from "../nar.ts";
import type { NarInfo } from "../narinfo.ts";

export { BinaryCache } from "./binary-cache.ts";
export { FsCache } from "./fs-cache.ts";
export { MultiStore } from "./multi.ts";
export { createHttpHandler } from "./serve.ts";

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
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface WritableStore extends Store {
  putInfo(
    hash: string,
    info: NarInfo,
  ): Promise<void>;

  putListing(
    hash: string,
    listing: NarListing,
  ): Promise<void>;

  putNar(
    info: { narPathname: string },
    nar: ReadableStream<Uint8Array>,
  ): Promise<void>;
}

export function isWritableStore(store: Store): store is WritableStore {
  return "putInfo" in store;
}
