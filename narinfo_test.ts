import { assertEquals } from "@std/assert";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { NarInfo } from "./narinfo.ts";

const INFO = `
StorePath: /nix/store/syd87l2rxw8cbsxmxl853h0r6pdwhwjr-curl-7.82.0-bin
URL: nar/05ra3y72i3qjri7xskf9qj8kb29r6naqy1sqpbs3azi3xcigmj56.nar.xz
Compression: xz
FileHash: sha256:05ra3y72i3qjri7xskf9qj8kb29r6naqy1sqpbs3azi3xcigmj56
FileSize: 68852
NarHash: sha256:1b4sb93wp679q4zx9k1ignby1yna3z7c4c2ri3wphylbc2dwsys0
NarSize: 196040
References: 0jqd0rlxzra1rs38rdxl43yh6rxchgc6-curl-7.82.0 6w8g7njm4mck5dmjxws0z1xnrxvl81xa-glibc-2.34-115 j5jxw3iy7bbz4a57fh9g2xm2gxmyal8h-zlib-1.2.12 yxvjs9drzsphm9pcf42a4byzj1kb9m7k-openssl-1.1.1n
Deriver: 5rwxzi7pal3qhpsyfc16gzkh939q1np6-curl-7.82.0.drv
Sig: cache.nixos.org-1:TsTTb3WGTZKphvYdBHXwo6weVILmTytUjLB+vcX89fOjjRicCHmKA4RCPMVLkj6TMJ4GMX3HPVWRdD1hkeKZBQ==
`;

const FINGERPRINT =
  `1;/nix/store/syd87l2rxw8cbsxmxl853h0r6pdwhwjr-curl-7.82.0-bin;sha256:1b4sb93wp679q4zx9k1ignby1yna3z7c4c2ri3wphylbc2dwsys0;196040;/nix/store/0jqd0rlxzra1rs38rdxl43yh6rxchgc6-curl-7.82.0,/nix/store/6w8g7njm4mck5dmjxws0z1xnrxvl81xa-glibc-2.34-115,/nix/store/j5jxw3iy7bbz4a57fh9g2xm2gxmyal8h-zlib-1.2.12,/nix/store/yxvjs9drzsphm9pcf42a4byzj1kb9m7k-openssl-1.1.1n`;

const binaryCache = {
  url: new URL("https://example.com"),
  storeDir: "/nix/store",
};

const narInfo = NarInfo.parse(INFO, binaryCache);

Deno.test("NarInfo fingerprint", () => {
  assertEquals(narInfo.fingerprint(), FINGERPRINT);
});

Deno.test("NarInfo signature verification", async (t) => {
  const keychain = await Keychain.create([NIXOS_KEY]);
  await t.step("valid", async () => {
    assertEquals(await narInfo.verify(keychain), { valid: true });
  });

  await t.step("corrupted signature", async () => {
    const corruptedText = INFO.replace(
      /^Sig: .*$/m,
      "Sig: cache.nixos.org-1:SGVsbG8gdGhlcmUhCg==",
    );
    const corruptedNarInfo = NarInfo.parse(corruptedText, binaryCache);

    assertEquals(await corruptedNarInfo.verify(keychain), {
      valid: false,
      reason: "INVALID_SIGNATURE",
    });
  });
});
