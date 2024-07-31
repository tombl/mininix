import { assert } from "@std/assert";

const ALPHABET = "0123456789abcdfghijklmnpqrsvwxyz";

// https://github.com/tvlfyi/tvix/blob/canon/nix-compat/src/nixbase32.rs
// https://github.com/nix-community/go-nix/blob/main/pkg/nixbase32/nixbase32.go

export function decodeNixBase32(input: string): Uint8Array {
  const output = new Uint8Array(Math.floor((input.length * 5) / 8));

  for (let n = 0; n < input.length; n++) {
    const b = n * 5;
    const i = Math.floor(b / 8);
    const j = b % 8;

    const char = input[input.length - n - 1];
    const digit = ALPHABET.indexOf(char);
    assert(digit !== -1, `Invalid base32 character: ${char}`);

    const value = digit << j;
    assert(i < output.length, "Invalid base32 string: trailing bits");
    output[i] |= value & 0xff;

    const carry = value >> 8;
    if (carry !== 0) {
      assert(i + 1 < output.length, "Invalid base32 string: trailing bits");
      output[i + 1] |= carry;
    }
  }

  return output;
}
