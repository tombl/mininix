import { assert } from "@std/assert/assert";
import { join } from "@std/path/join";
import { isNarListing, type NarListing } from "../nar.ts";
import { NarInfo } from "../narinfo.ts";
import type { WritableStore } from "./mod.ts";

export class FsCache implements WritableStore {
  storeDir = "/nix/store";

  #dir: string;
  private constructor(dir: string) {
    this.#dir = dir;
  }

  static async open(dir: string): Promise<FsCache> {
    await Deno.mkdir(join(dir, "nar"), { recursive: true });
    return new FsCache(dir);
  }

  async putInfo(hash: string, info: NarInfo) {
    const path = join(this.#dir, hash + ".narinfo");
    await Deno.writeTextFile(path, info.raw);
  }
  async getInfo(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarInfo> {
    const path = join(this.#dir, hash + ".narinfo");
    const text = await Deno.readTextFile(path, options);

    return NarInfo.parse(text, this, hash);
  }

  async putListing(hash: string, listing: NarListing) {
    const path = join(this.#dir, hash + ".ls");
    await Deno.writeTextFile(path, JSON.stringify(listing));
  }
  async getListing(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<NarListing> {
    const path = join(this.#dir, hash + ".ls");
    const json: unknown = JSON.parse(await Deno.readTextFile(path, options));
    assert(isNarListing(json));
    return json;
  }

  async putNar(
    info: { narPathname: string },
    nar: ReadableStream<Uint8Array>,
  ) {
    assert(info.narPathname.startsWith("nar/"));
    const path = join(this.#dir, info.narPathname);
    try {
      await Deno.writeFile(path + ".tmp", nar);
    } catch (error) {
      await Deno.remove(path + ".tmp");
      throw error;
    }
    await Deno.rename(path + ".tmp", path);
  }
  async getNar(
    info: { narPathname: string },
    options?: { signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>> {
    assert(info.narPathname.startsWith("nar/"));
    const path = join(this.#dir, info.narPathname);
    const body = await Deno.open(path, { read: true });

    options?.signal?.addEventListener("abort", () => body.close());

    // TODO: check that closing the body closes the file
    return body.readable;
  }
}
