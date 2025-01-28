import { assert } from "@std/assert/assert";
import {
  CompressionAlgorithm,
  createDecompressionStream,
  isCompressionAlgorithm,
} from "./compression.ts";
import { Hash, LengthVerifierStream } from "./hash.ts";
import { Keychain } from "./keychain.ts";
import { createNarEntryStream } from "./nar.ts";
import { Store } from "./store.ts";
import { Data, parseKeyValue, ProgressReportingStream } from "./util.ts";

export class NarInfo extends Data<{
  store: Store;
  hash: string;

  storePath: string;
  narPathname: string;
  compression: CompressionAlgorithm;
  fileHash: Hash;
  narHash: Hash;
  fileSize: number;
  narSize: number;
  references: string[];
  deriver: string;
  sig: string;
}> {
  async files(
    options?: {
      signal?: AbortSignal;
      onProgress?: (current: number, total: number) => void;
    },
  ) {
    const [listing, nar] = await Promise.all([
      this.store.getListing(this.hash, options),
      this.store.getNar(this, options),
    ]);
    let body = nar.body!;

    if (options?.onProgress) {
      const { onProgress } = options;
      onProgress(0, this.fileSize);
      body = body.pipeThrough(
        new ProgressReportingStream((current) => {
          onProgress(current, this.fileSize);
        }),
      );
    }

    return body
      .pipeThrough(new LengthVerifierStream(this.fileSize))
      .pipeThrough(this.fileHash.createVerifierStream())
      .pipeThrough(createDecompressionStream(this.compression))
      .pipeThrough(new LengthVerifierStream(this.narSize))
      .pipeThrough(this.narHash.createVerifierStream())
      .pipeThrough(createNarEntryStream(listing));
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
      this.references.map((ref) => `${this.store.storeDir}/${ref}`).join(","),
    ].join(";");
  }

  static parse(
    text: string,
    store: Store,
    hash: string,
  ) {
    const data = parseKeyValue(text, ": ");

    assert(
      isCompressionAlgorithm(data.Compression),
      `Unsupported compression algorithm: ${data.Compression}`,
    );

    return new NarInfo({
      store,
      hash,

      narPathname: data.URL,
      storePath: data.StorePath,
      compression: data.Compression,
      fileHash: new Hash(data.FileHash),
      narHash: new Hash(data.NarHash),
      fileSize: parseInt(data.FileSize),
      narSize: parseInt(data.NarSize),
      references: data.References.split(" ").filter(Boolean),
      deriver: data.Deriver,
      sig: data.Sig,
    });
  }

  get raw(): string {
    return [
      `URL: ${this.narPathname}`,
      `StorePath: ${this.storePath}`,
      `Compression: ${this.compression}`,
      `FileHash: ${this.fileHash.raw}`,
      `NarHash: ${this.narHash.raw}`,
      `FileSize: ${this.fileSize}`,
      `NarSize: ${this.narSize}`,
      `References: ${this.references.join(" ")}`,
      `Deriver: ${this.deriver}`,
      `Sig: ${this.sig}`,
    ].join("\n") + "\n";
  }
}
