import { assertEquals } from "@std/assert";
import { splitOnce } from "./util.ts";
import { decodeBase64 } from "@std/encoding/base64";

export const NIXOS_KEY =
  "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=";

function parse(raw: string) {
  const [name, encodedBytes] = splitOnce(raw, ":");
  return { name, bytes: decodeBase64(encodedBytes) };
}

export type VerificationResult =
  | { valid: true }
  | { valid: false; reason: "INVALID_SIGNATURE" }
  | { valid: false; reason: "NO_SUCH_KEY" };

export class Keychain {
  #keys = new Map<string, { key: CryptoKey; raw: string }>();

  static async create(trustedKeys: string[]) {
    const keychain = new Keychain();
    await Promise.all(trustedKeys.map((raw) => keychain.trust(raw)));
    return keychain;
  }

  async trust(raw: string) {
    const { name, bytes } = parse(raw);

    const existing = this.#keys.get(name);
    if (existing) {
      assertEquals(
        existing.raw,
        raw,
        "Imported a key with the same name but different data",
      );
      return existing.key;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      "Ed25519",
      true,
      ["verify"],
    );
    this.#keys.set(name, { key, raw });

    return key;
  }

  async verify(raw: string, data: BufferSource): Promise<VerificationResult> {
    const { name, bytes } = parse(raw);

    const signature = this.#keys.get(name);
    if (!signature) return { valid: false, reason: "NO_SUCH_KEY" };

    return (await crypto.subtle.verify("Ed25519", signature.key, bytes, data))
      ? { valid: true }
      : { valid: false, reason: "INVALID_SIGNATURE" };
  }
}
