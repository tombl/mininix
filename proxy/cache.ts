import { assert } from "@std/assert/assert";
import { join } from "@std/path/join";
import {
  createDecompressionStream,
  getCompressionAlgorithmFromExtension,
} from "../compression.ts";
import { NarInfo } from "../narinfo.ts";
import { Store } from "../store.ts";
import { isNarListing, NarListing } from "../nar.ts";

function getNarHash(pathname: string) {
  const idx = pathname.lastIndexOf(".nar");
  assert(idx !== -1);
  assert(pathname.startsWith("/nar/"));
  return pathname.slice("/nar/".length, idx);
}

export class FsCache implements Store {
  storeDir = "/nix/store";

  #dir: string;
  constructor(dir: string) {
    this.#dir = dir;
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
    const path = join(this.#dir, getNarHash(pathname) + ".nar");

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
    const path = join(this.#dir, getNarHash(info.narPathname) + ".nar");

    const body = await Deno.open(path, { read: true });
    options?.signal?.addEventListener("abort", () => body.close());

    // TODO: check that closing the body closes the file
    return new Response(body.readable, {
      headers: { "content-type": "application/x-nix-nar" },
    });
  }
}
