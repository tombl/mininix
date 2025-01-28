import { assert } from "@std/assert/assert";
import {
  CompressionAlgorithm,
  createDecompressionStream,
  isCompressionAlgorithm,
} from "./compression.ts";
import { Hash, LengthVerifierStream } from "./hash.ts";
import { Keychain } from "./keychain.ts";
import { createNarEntryStream } from "./nar.ts";
import { Data, parseKeyValue, ProgressReportingStream } from "./util.ts";

export class NarInfo extends Data<{
  storeDir: string;
  storePath: string;
  narURL: URL;
  compression: CompressionAlgorithm;
  fileHash: Hash;
  narHash: Hash;
  fileSize: number;
  narSize: number;
  references: string[];
  deriver: string;
  sig: string;
  raw: string;
  listingURL: URL;
}> {
  async files(
    {
      signal,
      onProgress,
    }: {
      signal?: AbortSignal;
      onProgress?: (current: number, total: number) => void;
    } = {},
  ) {
    const [listing, nar] = await Promise.all([
      fetch(this.listingURL, { signal }),
      fetch(this.narURL, { signal }),
    ]);
    if (!listing.ok) {
      throw new Error(
        `${listing.status} ${listing.statusText} ${this.listingURL}`,
      );
    }
    if (!nar.ok) {
      throw new Error(`${nar.status} ${nar.statusText} ${this.narURL}`);
    }

    let body = nar.body!;

    if (onProgress) {
      onProgress(0, this.fileSize);
      body = body.pipeThrough(
        new ProgressReportingStream((current) => {
          onProgress?.(current, this.fileSize);
        }),
      );
    }

    return body
      .pipeThrough(new LengthVerifierStream(this.fileSize))
      .pipeThrough(this.fileHash.createVerifierStream())
      .pipeThrough(createDecompressionStream(this.compression))
      .pipeThrough(new LengthVerifierStream(this.narSize))
      .pipeThrough(this.narHash.createVerifierStream())
      .pipeThrough(createNarEntryStream(await listing.json()));
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
    listingURL: URL,
  ) {
    const data = parseKeyValue(text, ": ");

    assert(
      isCompressionAlgorithm(data.Compression),
      `Unsupported compression algorithm: ${data.Compression}`,
    );

    return new NarInfo({
      storeDir: binaryCache.storeDir,
      storePath: data.StorePath,
      narURL: new URL(data.URL, binaryCache.url),
      compression: data.Compression,
      fileHash: new Hash(data.FileHash),
      narHash: new Hash(data.NarHash),
      fileSize: parseInt(data.FileSize),
      narSize: parseInt(data.NarSize),
      references: data.References.split(" ").filter(Boolean),
      deriver: data.Deriver,
      sig: data.Sig,
      raw: text,
      listingURL,
    });
  }
}
