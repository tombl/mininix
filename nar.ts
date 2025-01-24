import { ByteSliceStream, toTransformStream } from "@std/streams";
import { assertEquals } from "@std/assert";

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
  files.regular.sort((a, b) => a.narOffset - b.narOffset);

  return toTransformStream<Uint8Array, StreamEntry>(async function* (stream) {
    yield* files.directory;
    yield* files.symlink;

    for (const file of files.regular) {
      let stream2;
      [stream, stream2] = stream.tee();

      const body = stream2.pipeThrough(
        new ByteSliceStream(file.narOffset, file.narOffset + file.size),
      );
      yield { ...file, body };
    }

    await stream.cancel();
  });
}
