import { isNarListing, type NarListing } from "../nar.ts";
import { NarInfo } from "../narinfo.ts";
import { Data, parseKeyValue } from "../util.ts";
import type { Store } from "./mod.ts";

export class BinaryCache extends Data<{
  url: URL;
  storeDir: string;
  wantMassQuery: boolean;
  priority: number;
}> implements Store {
  static async open(url: URL): Promise<BinaryCache> {
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

  async getInfo(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarInfo> {
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

  async getNar(
    info: { narPathname: string },
    options: { signal?: AbortSignal } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.#fetch(info.narPathname, options);
    return response.body!;
  }
}
