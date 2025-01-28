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

  async get(hash: string, { signal }: { signal?: AbortSignal } = {}) {
    const response = await this.#fetch(hash + ".narinfo", { signal });
    return NarInfo.parse(
      await response.text(),
      this,
      new URL(hash + ".ls", this.url),
    );
  }
}

export class MultiStore extends Data<{ stores: Store[] }> implements Store {
  async get(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarInfo & { storeIndex: number }> {
    let error;
    for (let i = 0; i < this.stores.length; i++) {
      const store = this.stores[i];
      try {
        const info = await store.get(hash, options);
        return Object.assign(info, { storeIndex: i });
      } catch (e) {
        error = e;
      }
    }
    throw error;
  }
}
