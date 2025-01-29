import { assertEquals } from "@std/assert";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { NarInfo } from "./narinfo.ts";
import type { Store } from "./store/mod.ts";

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

const fakeStore: Store = {
  storeDir: "/nix/store",
  getInfo(_hash, _options) {
    throw new Error("Function not implemented.");
  },
  getListing(_hash, _options) {
    throw new Error("Function not implemented.");
  },
  getNar(_info, _options) {
    throw new Error("Function not implemented.");
  },
};

const narInfo = NarInfo.parse(INFO, fakeStore, "");
const keychain = await Keychain.create([NIXOS_KEY]);

Deno.test("fingerprint", () => {
  assertEquals(narInfo.fingerprint(), FINGERPRINT);
});

Deno.test("signature verification", async (t) => {
  await t.step("valid", async () => {
    assertEquals(await narInfo.verify(keychain), { valid: true });
  });

  await t.step("corrupted signature", async () => {
    const corruptedText = INFO.replace(
      /^Sig: .*$/m,
      "Sig: cache.nixos.org-1:SGVsbG8gdGhlcmUhCg==",
    );
    const corruptedNarInfo = NarInfo.parse(
      corruptedText,
      fakeStore,
      "",
    );

    assertEquals(await corruptedNarInfo.verify(keychain), {
      valid: false,
      reason: "INVALID_SIGNATURE",
    });
  });
});

Deno.test("empty references", async () => {
  const info = NarInfo.parse(
    `
StorePath: /nix/store/acfkqzj5qrqs88a4a6ixnybbjxja663d-xgcc-14-20241116-libgcc
URL: nar/05wlgdfa54n8fgyjscnr0r8bafmmcmc94h4xqwbdxibi9f0sxaj5.nar.xz
Compression: xz
FileHash: sha256:05wlgdfa54n8fgyjscnr0r8bafmmcmc94h4xqwbdxibi9f0sxaj5
FileSize: 73960
NarHash: sha256:0ysyzr56jyavf6xcybywjs3s5742b9kbvqq644khbak7d5y3fjnk
NarSize: 201856
References: 
Deriver: zcnm48hqxy3la7173czz5b7nxidssfxi-xgcc-14-20241116.drv
Sig: cache.nixos.org-1:xNltk6czOa3UXXEQ/mGMhr1Gzlt/OcT4P1QB7BKJ5dGSBGwhdgkocD2PKYwNiN1WB41AqEM9N69151pXFLasAA==
`,
    fakeStore,
    "",
  );
  assertEquals(info.references, []);
  assertEquals(await info.verify(keychain), { valid: true });
});
