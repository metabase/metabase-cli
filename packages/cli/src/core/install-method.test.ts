import { describe, expect, it } from "vitest";

import { buildInstallCommand, detectInstallMethod, type InstallMethod } from "./install-method";

describe("detectInstallMethod", () => {
  it("classifies a `.ts` entrypoint as dev", () => {
    const method = detectInstallMethod("/home/dev/mb-cli/src/cli.ts");
    expect(method).toEqual({
      kind: "dev",
      packageManager: "unknown",
      realPath: "/home/dev/mb-cli/src/cli.ts",
    });
  });

  it("classifies an _npx-cached binary as npx", () => {
    const method = detectInstallMethod(
      "/home/u/.npm/_npx/abc123/node_modules/@metabase/cli/dist/cli.mjs",
    );
    expect(method).toEqual({
      kind: "npx",
      packageManager: "npm",
      realPath: "/home/u/.npm/_npx/abc123/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies a path under `/lib/node_modules/` as npm-global", () => {
    const method = detectInstallMethod("/usr/local/lib/node_modules/@metabase/cli/dist/cli.mjs");
    expect(method).toEqual({
      kind: "npm-global",
      packageManager: "npm",
      realPath: "/usr/local/lib/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies a path under nvm `/lib/node_modules/` as npm-global", () => {
    expect(
      detectInstallMethod(
        "/home/u/.nvm/versions/node/v20.10.0/lib/node_modules/@metabase/cli/dist/cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "npm",
      realPath: "/home/u/.nvm/versions/node/v20.10.0/lib/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies a bun global path as npm-global / bun", () => {
    const method = detectInstallMethod(
      "/home/u/.bun/install/global/node_modules/@metabase/cli/dist/cli.mjs",
    );
    expect(method).toEqual({
      kind: "npm-global",
      packageManager: "bun",
      realPath: "/home/u/.bun/install/global/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies pnpm global paths as npm-global / pnpm", () => {
    expect(
      detectInstallMethod(
        "/home/u/.local/share/pnpm/global/5/node_modules/@metabase/cli/dist/cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "pnpm",
      realPath: "/home/u/.local/share/pnpm/global/5/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies yarn v1 global paths as npm-global / yarn", () => {
    expect(
      detectInstallMethod("/home/u/.config/yarn/global/node_modules/@metabase/cli/dist/cli.mjs"),
    ).toEqual({
      kind: "npm-global",
      packageManager: "yarn",
      realPath: "/home/u/.config/yarn/global/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("classifies a project node_modules path as npm-local", () => {
    const method = detectInstallMethod("/work/my-project/node_modules/@metabase/cli/dist/cli.mjs");
    expect(method).toEqual({
      kind: "npm-local",
      packageManager: "npm",
      realPath: "/work/my-project/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("normalizes Windows backslashes when matching markers", () => {
    expect(
      detectInstallMethod(
        "C:\\Users\\me\\.npm-global\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "npm",
      realPath: "C:\\Users\\me\\.npm-global\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
    });
  });

  it("classifies the Windows default `%APPDATA%\\npm\\node_modules\\` as npm-global", () => {
    expect(
      detectInstallMethod(
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "npm",
      realPath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
    });
  });

  it("classifies the Windows yarn-v1 global as npm-global / yarn", () => {
    expect(
      detectInstallMethod(
        "C:\\Users\\me\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "yarn",
      realPath:
        "C:\\Users\\me\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
    });
  });

  it("classifies the Windows pnpm global as npm-global / pnpm", () => {
    expect(
      detectInstallMethod(
        "C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
      ),
    ).toEqual({
      kind: "npm-global",
      packageManager: "pnpm",
      realPath:
        "C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
    });
  });

  it("classifies a binary inside an explicit npm_config_prefix as npm-global", () => {
    expect(
      detectInstallMethod("C:\\Tools\\nodejs\\node_modules\\@metabase\\cli\\dist\\cli.mjs", {
        npmConfigPrefix: "C:\\Tools\\nodejs",
      }),
    ).toEqual({
      kind: "npm-global",
      packageManager: "npm",
      realPath: "C:\\Tools\\nodejs\\node_modules\\@metabase\\cli\\dist\\cli.mjs",
    });
  });

  it("ignores npm_config_prefix when the binary lives outside it", () => {
    expect(
      detectInstallMethod("/work/my-project/node_modules/@metabase/cli/dist/cli.mjs", {
        npmConfigPrefix: "/usr/local",
      }),
    ).toEqual({
      kind: "npm-local",
      packageManager: "npm",
      realPath: "/work/my-project/node_modules/@metabase/cli/dist/cli.mjs",
    });
  });

  it("falls back to dev when nothing matches", () => {
    const method = detectInstallMethod("/usr/local/bin/some-other-bin");
    expect(method).toEqual({
      kind: "dev",
      packageManager: "unknown",
      realPath: "/usr/local/bin/some-other-bin",
    });
  });

  it("classifies an empty or undefined path as unknown", () => {
    expect(detectInstallMethod("")).toEqual({
      kind: "unknown",
      packageManager: "unknown",
      realPath: "",
    });
    expect(detectInstallMethod(undefined)).toEqual({
      kind: "unknown",
      packageManager: "unknown",
      realPath: "",
    });
  });
});

function makeMethod(
  kind: InstallMethod["kind"],
  pm: InstallMethod["packageManager"],
): InstallMethod {
  return { kind, packageManager: pm, realPath: "/x" };
}

describe("buildInstallCommand", () => {
  it("emits npm install -g for npm-global / npm", () => {
    expect(buildInstallCommand(makeMethod("npm-global", "npm"), "@metabase/cli", "0.2.0")).toEqual({
      argv: ["npm", "install", "-g", "@metabase/cli@0.2.0"],
      display: "npm install -g @metabase/cli@0.2.0",
    });
  });

  it("emits pnpm add -g for npm-global / pnpm", () => {
    expect(buildInstallCommand(makeMethod("npm-global", "pnpm"), "@metabase/cli", "0.2.0")).toEqual(
      {
        argv: ["pnpm", "add", "-g", "@metabase/cli@0.2.0"],
        display: "pnpm add -g @metabase/cli@0.2.0",
      },
    );
  });

  it("emits yarn global add for npm-global / yarn", () => {
    expect(buildInstallCommand(makeMethod("npm-global", "yarn"), "@metabase/cli", "0.2.0")).toEqual(
      {
        argv: ["yarn", "global", "add", "@metabase/cli@0.2.0"],
        display: "yarn global add @metabase/cli@0.2.0",
      },
    );
  });

  it("emits bun add -g for npm-global / bun", () => {
    expect(buildInstallCommand(makeMethod("npm-global", "bun"), "@metabase/cli", "0.2.0")).toEqual({
      argv: ["bun", "add", "-g", "@metabase/cli@0.2.0"],
      display: "bun add -g @metabase/cli@0.2.0",
    });
  });

  it("emits npm install for npm-local (no -g)", () => {
    expect(buildInstallCommand(makeMethod("npm-local", "npm"), "@metabase/cli", "0.2.0")).toEqual({
      argv: ["npm", "install", "@metabase/cli@0.2.0"],
      display: "npm install @metabase/cli@0.2.0",
    });
  });

  it("returns null for npx, dev, unknown", () => {
    expect(buildInstallCommand(makeMethod("npx", "npm"), "@metabase/cli", "0.2.0")).toBeNull();
    expect(buildInstallCommand(makeMethod("dev", "unknown"), "@metabase/cli", "0.2.0")).toBeNull();
    expect(
      buildInstallCommand(makeMethod("unknown", "unknown"), "@metabase/cli", "0.2.0"),
    ).toBeNull();
  });
});
