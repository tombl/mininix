import { join } from "@std/path";
import { concat } from "jsr:@std/bytes@^1.0.2/concat";

type Entry =
  | RegularEntry
  | SymlinkEntry
  | DirectoryEntry;

interface RegularEntry {
  type: "regular";
  narOffset: number;
  size: number;
  executable?: boolean;
}

interface SymlinkEntry {
  type: "symlink";
  target: string;
}

interface DirectoryEntry {
  type: "directory";
  entries: Record<string, Entry>;
}

export interface NarListing {
  root: Entry;
  version: 1;
}

function* walk(
  entry: Entry,
  path: string[],
): Generator<{ path: string[]; entry: Entry }, void> {
  yield { path, entry };
  if (entry.type === "directory") {
    for (const [name, child] of Object.entries(entry.entries)) {
      yield* walk(child, [...path, name]);
    }
  }
}

function flatten(nar: NarListing) {
  const files: Array<Entry & { path: string }> = [];

  for (const { path, entry } of walk(nar.root, [])) {
    files.push({ ...entry, path: path.join("/") });
  }

  const { regular = [], symlink = [], directory = [] } = Object.groupBy(
    files,
    (entry) => entry.type,
  ) as {
    regular?: Array<RegularEntry & { path: string }>;
    symlink?: Array<SymlinkEntry & { path: string }>;
    directory?: Array<DirectoryEntry & { path: string }>;
  };

  return { regular, symlink, directory };
}

type StreamEntry =
  | (RegularEntry & { path: string; body: Uint8Array })
  | (SymlinkEntry & { path: string })
  | (DirectoryEntry & { path: string });

export function createNarEntryStream(listing: NarListing) {
  const files = flatten(listing);
  let file = 0;
  let offset = 0;
  let extra: Uint8Array | undefined;

  return new TransformStream<Uint8Array, StreamEntry>({
    start(controller) {
      for (const entry of files.directory) controller.enqueue(entry);
      for (const entry of files.symlink) controller.enqueue(entry);
    },
    transform(chunk, controller) {
      if (extra) chunk = concat([extra, chunk]);
      extra = undefined;

      while (chunk.length > 0 && file < files.regular.length) {
        const entry = files.regular[file];
        const remainingSize = entry.size - offset;

        if (chunk.length >= remainingSize) {
          const body = chunk.subarray(0, remainingSize);
          controller.enqueue({ ...entry, body });
          chunk = chunk.subarray(remainingSize);
          file++;
          offset = 0;
        } else {
          offset += chunk.length;
          break;
        }
      }

      extra = chunk;
    },
  });
}

if (import.meta.main) {
  const listing: NarListing = JSON.parse(
    await Deno.readTextFile(Deno.args[0]),
  );
  const out = Deno.args[1] ?? "./out";
  for await (
    const entry of Deno.stdin.readable.pipeThrough(
      createNarEntryStream(listing),
    )
  ) {
    const path = join(out, entry.path);
    switch (entry.type) {
      case "regular":
        await Deno.writeFile(path, entry.body, {
          mode: entry.executable ? 0o755 : 0o644,
        });
        break;
      case "symlink":
        console.log(entry.target);
        // await Deno.symlink(entry.target, path);
        break;
      case "directory":
        await Deno.mkdir(path);
        break;
    }
  }
}
