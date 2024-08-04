import { assertEquals, assertRejects } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { Keychain, NIXOS_KEY } from "./keychain.ts";
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

    await t.step("fetch", async (t) => {
      info = await cache.narInfo("kwmqk7ygvhypxadsdaai27gl6qfxv7za");
      await assertSnapshot(t, info);
    });

    await t.step("verify", async () => {
      assertEquals(await info.verify(nixosKeychain), { valid: true });
      assertEquals(await info.verify(emptyKeychain), {
        valid: false,
        reason: "NO_SUCH_KEY",
      });
    });

    await t.step("nar", async (t) => {
      await t.step("valid", async (t) => {
        const validInfo = info.clone();
        const nar = await validInfo.nar();
        const bytes = await new Response(nar).arrayBuffer();
        await assertSnapshot(t, bytes.byteLength);
      });

      await t.step("wrong compressed size", async () => {
        const wrongInfo = info.clone();
        wrongInfo.fileSize *= 2;
        await assertRejects(async () => {
          const nar = await wrongInfo.nar();
          await new Response(nar).arrayBuffer();
        });
      });

      await t.step("wrong decompressed size", async () => {
        const wrongInfo = info.clone();
        wrongInfo.narSize *= 2;
        await assertRejects(async () => {
          const nar = await wrongInfo.nar();
          await new Response(nar).arrayBuffer();
        });
      });

      await t.step("wrong compressed hash", async () => {
        const wrongInfo = info.clone();
        wrongInfo.fileHash.hash[0]++;
        await assertRejects(async () => {
          const nar = await wrongInfo.nar();
          await new Response(nar).arrayBuffer();
        });
      });

      await t.step("wrong decompressed hash", async () => {
        const wrongInfo = info.clone();
        wrongInfo.narHash.hash[0]++;
        await assertRejects(async () => {
          const nar = await wrongInfo.nar();
          await new Response(nar).arrayBuffer();
        });
      });
    });
  },
});
