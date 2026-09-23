import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionCommandError } from "./errors";
import { PREVIEW_BYTE_LIMIT, readPreview } from "./preview";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

async function checkout(): Promise<string> {
  const root = await temporaryDirectory("rde-preview-");
  await mkdir(join(root, "collections"), { recursive: true });
  return root;
}

describe("readPreview", () => {
  it("reads a text file whole", async () => {
    const root = await checkout();
    await writeFile(join(root, "collections", "orders.yaml"), "name: Orders\n", "utf8");

    expect(await readPreview(root, "collections/orders.yaml")).toEqual({
      kind: "text",
      path: "collections/orders.yaml",
      text: "name: Orders\n",
    });
  });

  it("names a file with a NUL byte as binary and does not send its bytes", async () => {
    const root = await checkout();
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));

    expect(await readPreview(root, "logo.png")).toEqual({
      kind: "binary",
      path: "logo.png",
      bytes: 4,
    });
  });

  it("refuses a file over the limit with its size", async () => {
    const root = await checkout();
    const size = PREVIEW_BYTE_LIMIT + 1;
    await writeFile(join(root, "big.sql"), "x".repeat(size), "utf8");

    expect(await readPreview(root, "big.sql")).toEqual({
      kind: "too-large",
      path: "big.sql",
      bytes: size,
      limit: PREVIEW_BYTE_LIMIT,
    });
  });

  it("says a file that left the checkout is gone", async () => {
    const root = await checkout();

    expect(await readPreview(root, "collections/deleted.yaml")).toEqual({
      kind: "gone",
      path: "collections/deleted.yaml",
    });
  });

  it("follows a symlink that stays inside the checkout", async () => {
    const root = await checkout();
    await writeFile(join(root, "collections", "orders.yaml"), "name: Orders\n", "utf8");
    await symlink(join(root, "collections", "orders.yaml"), join(root, "current.yaml"));

    expect(await readPreview(root, "current.yaml")).toEqual({
      kind: "text",
      path: "current.yaml",
      text: "name: Orders\n",
    });
  });

  it("refuses a symlink that leads outside the checkout", async () => {
    const root = await checkout();
    const outside = await temporaryDirectory("rde-outside-");
    await writeFile(join(outside, "secret.txt"), "secret\n", "utf8");
    await symlink(join(outside, "secret.txt"), join(root, "secret.txt"));

    const refusal = readPreview(root, "secret.txt");

    await expect(refusal).rejects.toThrow(SessionCommandError);
    await expect(refusal).rejects.toThrow("secret.txt leads outside the session's checkout.");
  });

  it("refuses a directory", async () => {
    const root = await checkout();

    const refusal = readPreview(root, "collections");

    await expect(refusal).rejects.toThrow(SessionCommandError);
    await expect(refusal).rejects.toThrow("collections is not a file.");
  });
});
