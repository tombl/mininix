import { encodeHex } from "@std/encoding/hex";
import { createHash } from "node:crypto";
import { decodeNixBase32 } from "./base32.ts";
import { splitOnce } from "./util.ts";
import { assertEquals } from "@std/assert";

export class Hash {
  raw: string;
  algorithm: string;
  hash: Uint8Array;

  constructor(raw: string) {
    this.raw = raw;
    const [algorithm, encodedHash] = splitOnce(raw, ":");
    this.algorithm = algorithm;
    this.hash = decodeNixBase32(encodedHash);
  }

  createVerifierStream() {
    return new HashVerifierStream(this.algorithm, this.hash);
  }
}

class HashVerifierStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(
    algorithm: string,
    expectedHash: Uint8Array,
  ) {
    const hasher = createHash(algorithm);

    super({
      transform(chunk, controller) {
        hasher.update(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        assertEquals(
          new Uint8Array(hasher.digest()),
          expectedHash,
          `Hash mismatch`,
        );
      },
    });
  }
}

export class LengthVerifierStream
  extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expectedLength: number) {
    let actualLength = 0;

    super({
      transform(chunk, controller) {
        actualLength += chunk.length;
        controller.enqueue(chunk);
      },
      flush() {
        assertEquals(actualLength, expectedLength, `Length mismatch`);
      },
    });
  }
}
