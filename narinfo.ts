import { assert } from "@std/assert/assert";
import {
  CompressionAlgorithm,
  createDecompressionStream,
  isCompressionAlgorithm,
} from "./compression.ts";
import { Hash, LengthVerifierStream } from "./hash.ts";
import { Keychain } from "./keychain.ts";
import { Data, parseKeyValue } from "./util.ts";
import { NarListing } from "./nar.ts";

export class NarInfo extends Data<{
  storeDir: string;
  listing: NarListing;
  storePath: string;
  url: URL;
  compression: CompressionAlgorithm;
  fileHash: Hash;
  narHash: Hash;
  fileSize: number;
  narSize: number;
  references: string[];
  deriver: string;
  sig: string;
}> {
  async nar() {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response.body!
      .pipeThrough(new LengthVerifierStream(this.fileSize))
      .pipeThrough(this.fileHash.createVerifierStream())
      .pipeThrough(createDecompressionStream(this.compression))
      .pipeThrough(new LengthVerifierStream(this.narSize))
      .pipeThrough(this.narHash.createVerifierStream());
  }

  verify(keychain: Keychain) {
    return keychain.verify(
      this.sig,
      new TextEncoder().encode(this.fingerprint()),
    );
  }

  fingerprint() {
    return [
      "1",
      this.storePath,
      this.narHash.raw,
      this.narSize.toFixed(0),
      this.references.map((ref) => `${this.storeDir}/${ref}`).join(","),
    ].join(";");
  }

  static parse(
    text: string,
    binaryCache: { storeDir: string; url: URL },
    listing: NarListing,
  ) {
    const data = parseKeyValue(text, ": ");

    assert(
      isCompressionAlgorithm(data.Compression),
      `Unsupported compression algorithm: ${data.Compression}`,
    );

    return new NarInfo({
      storeDir: binaryCache.storeDir,
      listing,
      storePath: data.StorePath,
      url: new URL(data.URL, binaryCache.url),
      compression: data.Compression,
      fileHash: new Hash(data.FileHash),
      narHash: new Hash(data.NarHash),
      fileSize: parseInt(data.FileSize),
      narSize: parseInt(data.NarSize),
      references: data.References.split(" "),
      deriver: data.Deriver,
      sig: data.Sig,
    });
  }
}
