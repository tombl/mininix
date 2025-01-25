import { toText } from "@std/streams";

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

function spawn(command: string): TransformStream<Uint8Array, Uint8Array> {
  // warning! this function is horrible. i've tried like 10 different ways to
  // make it work, and this is the only one that works. i'm sorry.
  // also it leaks ops, but not if you pass --trace-leaks

  const proc = new Deno.Command(command, {
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    args: ["-vv"],
  }).spawn();

  const stdin = proc.stdin.getWriter();
  let writer: Promise<void>;

  return new TransformStream({
    start(controller) {
      writer = proc.stdout.pipeTo(
        new WritableStream({
          write(chunk) {
            try {
              controller.enqueue(chunk);
            } catch {
              // intentionally ignore because we're already terminating
            }
          },
          close() {
            controller.terminate();
          },
          abort(reason) {
            controller.error(reason);
          },
        }),
      );

      proc.status.then(
        async (status) => {
          if (status.success) {
            await proc.stderr.cancel();
          } else {
            const text = await toText(proc.stderr);
            controller.error(new Error(text));
          }
        },
        (err) => {
          controller.error(err);
        },
      );
    },
    async transform(chunk) {
      await stdin.write(chunk);
    },
    async flush() {
      await stdin.close();
      await writer;
    },
    async cancel(reason) {
      await stdin.abort(reason);
      proc.kill();
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
      return spawn("bzcat");
    case "zstd":
      return spawn("zstdcat");
    case "xz":
      return spawn("xzcat");
    default:
      throw new Error(
        `Unsupported decompression algorithm: ${algorithm satisfies never}`,
      );
  }
}
