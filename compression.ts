import { spawn } from "node:child_process";
import { once } from "node:events";
import { text as toText } from "node:stream/consumers";

const ALGORITHMS = [
  "none",
  "gzip",
  "bzip2",
  "zstd",
  "xz",
] as const;
export type CompressionAlgorithm = typeof ALGORITHMS[number];

export function isCompressionAlgorithm(
  value: string,
): value is CompressionAlgorithm {
  return (ALGORITHMS as readonly string[]).includes(value);
}

function spawnTransformer(
  command: string,
): TransformStream<Uint8Array, Uint8Array> {
  // warning! this function is horrible. i've tried like 10 different ways to
  // make it work, and this is the only one that works. i'm sorry.
  // also it leaks ops, but not if you pass --trace-leaks

  const proc = spawn(command);

  return new TransformStream({
    start(controller) {
      proc.stdout.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      proc.stdout.on("close", () => {
        controller.terminate();
      });
      proc.stdout.on("error", (err) => {
        controller.error(err);
      });

      proc.on("exit", async (status) => {
        if (status === 0) {
          proc.stderr.destroy();
        } else {
          const text = await toText(proc.stderr);
          controller.error(new Error(text));
        }
      });

      proc.on("error", (err) => {
        controller.error(err);
      });
    },
    async transform(chunk) {
      await new Promise<void>((resolve, reject) =>
        proc.stdin.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        })
      );
    },
    async flush() {
      await new Promise<void>((resolve) => proc.stdin.end(resolve));
      await once(proc.stdin, "close");
    },
    async cancel(reason) {
      proc.stdin.destroy(reason);
      await once(proc.stdin, "close");
    },
  });
}

export function createDecompressionStream(
  algorithm: CompressionAlgorithm,
): TransformStream<Uint8Array, Uint8Array> {
  switch (algorithm) {
    case "none":
      return new TransformStream();
    case "gzip":
      return new DecompressionStream("gzip");
    case "bzip2":
      return spawnTransformer("bzcat");
    case "zstd":
      return spawnTransformer("zstdcat");
    case "xz":
      return spawnTransformer("xzcat");
    default:
      throw new Error(
        `Unsupported decompression algorithm: ${algorithm satisfies never}`,
      );
  }
}

export function getCompressionAlgorithmFromExtension(
  name: string,
): CompressionAlgorithm {
  if (name.endsWith("gz")) return "gzip";
  if (name.endsWith("bz2")) return "bzip2";
  if (name.endsWith("zst")) return "zstd";
  if (name.endsWith("xz")) return "xz";
  return "none";
}

if (import.meta.main) {
  await Deno.stdin.readable
    .pipeThrough(createDecompressionStream("zstd"))
    .pipeTo(Deno.stderr.writable);
}
