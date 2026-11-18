import "server-only";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
/** Same get/put repository contract as speech storage, with atomic local writes. */
export interface Repository<T> {
  get(id: string): Promise<T | null>;
  put(id: string, value: T): Promise<void>;
  create?(id: string, value: T): Promise<T>;
}
export class FileRepository<T> implements Repository<T> {
  constructor(
    private directory = path.join(process.cwd(), ".cache", "lessons"),
    private validate?: (data:unknown)=>T,
  ) {}
  private file(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid lesson ID");
    return path.join(this.directory, `${id}.json`);
  }
  async get(id: string) {
    try {
      const data:unknown = JSON.parse(await readFile(this.file(id), "utf8"));
      return this.validate ? this.validate(data) : data as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        "Cannot read local lesson storage. Check filesystem permissions.",
      );
    }
  }
  async put(id: string, value: T) {
    await mkdir(this.directory, { recursive: true });
    const tmp = this.file(id) + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await rename(tmp, this.file(id));
  }
}
