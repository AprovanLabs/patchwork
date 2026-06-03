import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalFileBackend } from "../widget-store/local-backend.js";

let testDir: string;

beforeEach(async () => {
  testDir = resolve(tmpdir(), `widget-store-test-${randomUUID()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("LocalFileBackend", () => {
  it("writes and reads files", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.writeFile("test.txt", "hello");
    const content = await backend.readFile("test.txt");
    expect(content).toBe("hello");
  });

  it("creates parent directories on write", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.writeFile("sub/dir/file.txt", "nested");
    const content = await backend.readFile("sub/dir/file.txt");
    expect(content).toBe("nested");
  });

  it("checks file existence", async () => {
    const backend = new LocalFileBackend(testDir);
    expect(await backend.exists("missing.txt")).toBe(false);
    await backend.writeFile("exists.txt", "yes");
    expect(await backend.exists("exists.txt")).toBe(true);
  });

  it("deletes files", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.writeFile("todelete.txt", "bye");
    await backend.unlink("todelete.txt");
    expect(await backend.exists("todelete.txt")).toBe(false);
  });

  it("stats files and directories", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.writeFile("file.txt", "content");
    const fileStat = await backend.stat("file.txt");
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.size).toBe(7);

    await backend.mkdir("mydir");
    const dirStat = await backend.stat("mydir");
    expect(dirStat.isDirectory()).toBe(true);
  });

  it("lists directory entries", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.writeFile("a.txt", "a");
    await backend.writeFile("b.txt", "b");
    await backend.mkdir("subdir");

    const entries = await backend.readdir("");
    const names = entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");

    const subdirEntry = entries.find((e) => e.name === "subdir");
    expect(subdirEntry!.isDirectory()).toBe(true);
  });

  it("removes directories recursively", async () => {
    const backend = new LocalFileBackend(testDir);
    await backend.mkdir("sub/nested", { recursive: true });
    await backend.writeFile("sub/nested/file.txt", "data");

    await backend.rmdir("sub", { recursive: true });
    expect(await backend.exists("sub")).toBe(false);
  });

  it("survives widget store pattern (save + load)", async () => {
    const backend = new LocalFileBackend(testDir);

    await backend.writeFile("widgets/my-widget/abc123/view.html", "<html>test</html>");
    await backend.writeFile(
      "widgets/my-widget/abc123/manifest.json",
      JSON.stringify({ name: "my-widget", version: "1.0", hash: "abc123" }),
    );

    const html = await backend.readFile("widgets/my-widget/abc123/view.html");
    expect(html).toBe("<html>test</html>");

    const manifest = JSON.parse(await backend.readFile("widgets/my-widget/abc123/manifest.json"));
    expect(manifest.name).toBe("my-widget");
  });
});
