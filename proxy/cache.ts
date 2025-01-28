import { assert } from "@std/assert/assert";
import { join } from "@std/path/join";
import {
  createDecompressionStream,
  getCompressionAlgorithmFromExtension,
} from "../compression.ts";
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

    const compressedInfo = NarInfo.parse(text, this, hash);
    const info = compressedInfo.clone();

    info.compression = "none";

    // trim compression extension
    const dotNarIndex = info.narPathname.lastIndexOf(".nar");
    assert(dotNarIndex !== -1);
    info.narPathname = info.narPathname.slice(0, dotNarIndex) + ".nar";

    try {
      // if the nar is in the cache, return the uncompressed info
      const response = await this.getNar(info);
      await response.body!.cancel();
      return info;
    } catch (error) {
      console.error(
        "nar not found",
        info.narPathname,
        compressedInfo.narPathname,
        error,
      );
      // otherwise, return the compressed info
      return compressedInfo;
    }
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
    const idx = pathname.lastIndexOf(".nar");
    assert(idx !== -1);

    assert(pathname.startsWith("nar/"));
    const hash = pathname.slice("nar/".length, idx);

    const path = join(this.#dir, "nar", hash + ".nar");

    const body = response.body!.pipeThrough(
      createDecompressionStream(
        getCompressionAlgorithmFromExtension(response.url),
      ),
    );

    await Deno.writeFile(path, body);
  }
  async getNar(
    info: { narPathname: string },
    options?: { signal?: AbortSignal },
  ): Promise<Response> {
    if (!info.narPathname.endsWith(".nar")) {
      throw new Error("this store only supports uncompressed nars");
    }
    assert(info.narPathname.startsWith("nar/"));

    const path = join(this.#dir, "nar", info.narPathname.slice("nar/".length));

    const body = await Deno.open(path, { read: true });
    options?.signal?.addEventListener("abort", () => body.close());

    console.log("NAR HIT", info.narPathname);

    // TODO: check that closing the body closes the file
    return new Response(body.readable, {
      headers: { "content-type": "application/x-nix-nar" },
    });
  }
}
