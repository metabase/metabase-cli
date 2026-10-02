import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDataApp } from "./manifest";

const dirs: string[] = [];

async function appDir(
  manifest: string,
  bundle: { path: string; text: string } | null,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-data-app-"));
  dirs.push(dir);
  await writeFile(join(dir, "data_app.yaml"), manifest);
  if (bundle !== null) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, bundle.path), bundle.text);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadDataApp", () => {
  it("maps data_app.yaml to the API fields and reads the bundle at its path, ignoring serdes keys", async () => {
    const dir = await appDir(
      [
        "version: 2",
        "name: Sales overview",
        "slug: sales-overview",
        "description: Pipeline health",
        "path: ./dist/app.js",
        "allowed_hosts:",
        "  - https://api.example.com",
        "entity_id: Xq2v9LbN0mTz4wRk7YsJd",
        "serdes/meta:",
        "- model: DataApp",
        "  id: Xq2v9LbN0mTz4wRk7YsJd",
        "  label: sales-overview",
      ].join("\n"),
      { path: "dist/app.js", text: "bundle();" },
    );

    expect(await loadDataApp(dir)).toEqual({
      slug: "sales-overview",
      fields: {
        display_name: "Sales overview",
        bundle_path: "./dist/app.js",
        bundle: "bundle();",
        description: "Pipeline health",
        version: 2,
        allowed_hosts: ["https://api.example.com"],
      },
    });
  });

  it("defaults the bundle path to ./dist/index.js and sends only the fields the manifest sets", async () => {
    const dir = await appDir("name: Sales\nslug: sales\n", { path: "dist/index.js", text: "b" });

    expect(await loadDataApp(dir)).toEqual({
      slug: "sales",
      fields: { display_name: "Sales", bundle_path: "./dist/index.js", bundle: "b" },
    });
  });

  it("refuses a slug that is not dash-cased", async () => {
    const dir = await appDir("name: Sales\nslug: Sales_App\n", {
      path: "dist/index.js",
      text: "b",
    });

    await expect(loadDataApp(dir)).rejects.toMatchObject({
      userMessage: expect.stringMatching(/slug.*dash-cased/s),
    });
  });

  it("names the missing bundle when the app has not been built", async () => {
    const dir = await appDir("name: Sales\nslug: sales\n", null);

    await expect(loadDataApp(dir)).rejects.toThrow(/index\.js/);
  });
});
