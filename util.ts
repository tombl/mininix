export function splitOnce(str: string, sep: string): [string, string] {
  const idx = str.indexOf(sep);
  if (idx === -1) return [str, ""];
  return [str.slice(0, idx), str.slice(idx + sep.length)];
}

export function parseKeyValue(data: string, sep: string) {
  return Object.fromEntries(
    data.split("\n")
      .filter(Boolean)
      .map((line) => splitOnce(line, sep)),
  );
}

interface DataConstructor {
  new <T extends object>(data: T): Data<T>;
}
interface DataMethods {
  clone(): this;
}

export type Data<T extends object> = T & DataMethods;

class DataClass {
  constructor(data: object) {
    Object.assign(this, data);
  }

  clone() {
    return new (this.constructor as DataConstructor)(this);
  }
}

export const Data = DataClass as DataConstructor;

export class ProgressReportingStream extends TransformStream {
  bytes = 0;

  constructor(report: (bytes: number) => void) {
    super({
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
        this.bytes += chunk.length;
        report(this.bytes);
      },
    });
  }
}
