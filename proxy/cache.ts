import { assert } from "@std/assert/assert";
import { join } from "@std/path/join";
import { isNarListing, NarListing } from "../nar.ts";
import { NarInfo } from "../narinfo.ts";
import { Store } from "../store.ts";

export class FsCache implements Store {
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
    const path = join(this.#dir, hash);

    await Deno.writeTextFile(path + ".narinfo", info.raw);
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
    const path = join(this.#dir, hash);
    await Deno.writeTextFile(path + ".ls", JSON.stringify(listing));
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

  async putNar(pathname: string, response: Response) {
    assert(pathname.startsWith("nar/"));
    const path = join(this.#dir, pathname);
    await Deno.writeFile(path + ".tmp", response.body!);
    await Deno.rename(path + ".tmp", path);
  }
  async getNar(
    info: { narPathname: string },
    options?: { signal?: AbortSignal },
  ): Promise<Response> {
    assert(info.narPathname.startsWith("nar/"));
    const path = join(this.#dir, info.narPathname);
    const body = await Deno.open(path, { read: true });

    options?.signal?.addEventListener("abort", () => body.close());

    // TODO: check that closing the body closes the file
    return new Response(body.readable, {
      headers: { "content-type": "application/x-nix-nar" },
    });
  }
}
