import { NarInfo } from "./narinfo.ts";
import { Data, parseKeyValue } from "./util.ts";

export class BinaryCache extends Data<{
  url: URL;
  storeDir: string;
  wantMassQuery: boolean;
  priority: number;
}> {
  static async open(url: URL) {
    if (!url.pathname.endsWith("/")) url = new URL(url.href + "/");
    const response = await fetch(new URL("nix-cache-info", url));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const data = parseKeyValue(await response.text(), ": ");
    return new BinaryCache({
      url,
      storeDir: data.StoreDir,
      wantMassQuery: data.WantMassQuery === "1",
      priority: parseInt(data.Priority ?? "0"),
    });
  }

  fetch(path: string, init?: RequestInit) {
    return fetch(new URL(path, this.url), init);
  }

  async narInfo(hash: string) {
    const response = await this.fetch(hash + ".narinfo");
    const text = await response.text();
    return NarInfo.parse(text, this);
  }
}
