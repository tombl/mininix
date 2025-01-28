import { assertEquals, assertRejects } from "@std/assert";
import { toArrayBuffer } from "@std/streams";
import { assertSnapshot } from "@std/testing/snapshot";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
import { StreamEntry } from "./nar.ts";
import { NarInfo } from "./narinfo.ts";
import { BinaryCache } from "./store.ts";

const netPermission = await Deno.permissions.query({ name: "net" });

Deno.test({
  name: "nixpkgs#hello",
  ignore: netPermission.state !== "granted",
  async fn(t) {
    const cache = await BinaryCache.open(new URL("https://cache.nixos.org"));
    const nixosKeychain = await Keychain.create([NIXOS_KEY]);
    const emptyKeychain = new Keychain();

    let info: NarInfo;

    async function consume(nar: ReadableStream<StreamEntry>) {
      for await (const entry of nar) {
        if (entry.type !== "regular") continue;
        const body = await toArrayBuffer(entry.body);

        if (entry.path.startsWith("bin/")) {
          assertEquals(
            body.slice(0, 4),
            new TextEncoder().encode("\x7fELF").buffer,
          );
          assertEquals(entry.executable, true);
        }
      }
    }

    await t.step("fetch", async (t) => {
      info = await cache.getInfo("a7hnr9dcmx3qkkn8a20g7md1wya5zc9l");
      await assertSnapshot(t, info);
    });

    await t.step("verify", async (t) => {
      await t.step("valid", async () => {
        assertEquals(await info.verify(nixosKeychain), { valid: true });
      });

      await t.step("invalid", async () => {
        assertEquals(await info.verify(emptyKeychain), {
          valid: false,
          reason: "NO_SUCH_KEY",
        });
      });
    });

    await t.step("nar", async (t) => {
      await t.step("valid", async () => {
        const validInfo = info.clone();
        const nar = await validInfo.files();
        await consume(nar);
      });

      await t.step("wrong compressed size", async () => {
        const wrongInfo = info.clone();
        wrongInfo.fileSize *= 2;
        await assertRejects(async () => {
          const nar = await wrongInfo.files();
          await consume(nar);
        });
      });

      // flaky:
      // await t.step("wrong decompressed size", async () => {
      //   const wrongInfo = info.clone();
      //   wrongInfo.narSize *= 2;
      //   await assertRejects(async () => {
      //     const nar = await wrongInfo.files();
      //     await consume(nar);
      //   });
      // });

      await t.step("wrong compressed hash", async () => {
        const wrongInfo = info.clone();
        wrongInfo.fileHash.hash[0] ^= 0xff;
        await assertRejects(async () => {
          const nar = await wrongInfo.files();
          await consume(nar);
        });
      });

      await t.step("wrong decompressed hash", async () => {
        const wrongInfo = info.clone();
        wrongInfo.narHash.hash[0] ^= 0xff;
        await assertRejects(async () => {
          const nar = await wrongInfo.files();
          await consume(nar);
        });
      });
    });
  },
});
