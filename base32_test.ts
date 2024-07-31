import { encodeHex } from "@std/encoding/hex";
import { assertEquals, assertThrows } from "@std/assert";
import { decodeNixBase32 } from "./base32.ts";

const VALID: Record<string, [base32: string, hex: string]> = {
  empty: ["", ""],
  "one byte": ["0z", "1f"],
  "store path": [
    "00bgd045z0d4icpbc2yyz4gx48ak44la",
    "8a12321522fd91efbd60ebb2481af88580f61600",
  ],
  sha256: [
    "0c5b8vw40dy178xlpddw65q9gf1h2186jcc3p4swinwggbllv8mk",
    "b3a24de97a8fdbc835b9833169501030b8977031bcb54b3b3ac13740f846ab30",
  ],
};

const INVALID: Record<string, string> = {
  "carry": "zz",
  "carry 2": "c0",
  "length": "0",
  "length 2": "0zz",
  "character": "ee",
};

Deno.test("decode valid", async (t) => {
  for (const [name, [base32, hex]] of Object.entries(VALID)) {
    await t.step(name, () => {
      assertEquals(encodeHex(decodeNixBase32(base32)), hex);
    });
  }
});

Deno.test("decode invalid", async (t) => {
  for (const [name, base32] of Object.entries(INVALID)) {
    await t.step(name, () => {
      assertThrows(() => decodeNixBase32(base32));
    });
  }
});
