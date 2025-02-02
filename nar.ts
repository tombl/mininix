import { sortBy } from "@std/collections";
import { ByteSliceStream, toTransformStream } from "@std/streams";

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

export function isNarListing(value: unknown): value is NarListing {
  return (
    typeof value === "object" &&
    value !== null &&
    "root" in value &&
    "version" in value &&
    value.version === 1
  );
}

export function createNarEntryStream(
  listing: NarListing,
): TransformStream<Uint8Array, StreamEntry> {
  const files = flatten(listing);
  sortBy(files.regular, (f) => f.narOffset, { order: "asc" });

  return toTransformStream<Uint8Array, StreamEntry>(async function* (stream) {
    yield* files.directory;

    for (const file of files.regular) {
      let stream2;
      [stream, stream2] = stream.tee();

      const body = stream2.pipeThrough(
        new ByteSliceStream(file.narOffset, file.narOffset + file.size),
      );
      yield { ...file, body };
    }

    yield* files.symlink;

    await stream.cancel();
  });
}
