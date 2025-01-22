import { join } from "@std/path";
import { concat } from "@std/bytes/concat";
import { assertEquals } from "@std/assert/equals";

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

export type StreamEntry =
  | (RegularEntry & { path: string; body: ReadableStream<Uint8Array> })
  | (SymlinkEntry & { path: string })
  | (DirectoryEntry & { path: string });

export function createNarEntryStream(listing: NarListing) {
  assertEquals(listing.version, 1);

  const files = flatten(listing);
  let current: {
    file: RegularEntry & { path: string };
    writer: WritableStreamDefaultWriter<Uint8Array>;
  } | undefined = undefined;

  // Sort the files by offset, with the first file being the first popped.
  files.regular.sort((a, b) => a.narOffset - b.narOffset);

  return new TransformStream<Uint8Array, StreamEntry>({
    start(controller) {
      for (const entry of files.directory) controller.enqueue(entry);
      for (const entry of files.symlink) controller.enqueue(entry);
    },
    transform(chunk, controller) {
      while (chunk.length) {
        if (!current) {
          const file = files.regular.pop();
          if (!file) return controller.error(new Error("trailing data"));
          const { readable, writable } = new TransformStream<Uint8Array>();
          controller.enqueue({ ...file, body: readable });
          current = { file, writer: writable.getWriter() };
        }

        const { file, writer } = current;
        const slice = chunk.subarray(0, file.size);

        writer.write(slice);
        file.size -= slice.length;
        chunk = chunk.subarray(slice.length);

        if (file.size === 0) {
          writer.close();
          current = undefined;
        }
      }
    },
    flush() {
      console.log("flush");
      current?.writer.abort();
    }
  });
}
