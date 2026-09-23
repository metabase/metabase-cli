import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { parseJson } from "@metabase/client/json";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import {
  probeAt,
  seedProbedProfile,
  setupTempConfigHome,
  type TempConfigHome,
} from "../../core/auth/temp-config-home";
import { ENV_SKILLS_DIR } from "../../core/env";
import { createTempSkillsDir, type TempSkillsDir } from "../../core/temp-skills-dir";
import skillsListCommand, { SkillListEnvelope } from "./list";

interface CapturedStream {
  chunks: string[];
  parse: <T>(schema: ZodType<T>) => T;
}

function capture(stream: NodeJS.WriteStream): CapturedStream {
  const chunks: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    chunks,
    parse: <T>(schema: ZodType<T>) => parseJson(chunks.join(""), schema, { source: "stdout" }),
  };
}

const GAMMA_UNAVAILABLE_ON_58 = {
  name: "gamma",
  failure: {
    reason: "version-too-old",
    detail:
      "This operation requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase to use it.",
    feature: "remoteSync",
    since: 60,
    tokenFeature: "remote_sync",
    serverVersion: "v0.58.0",
  },
};

describe("skills list command", () => {
  let skills: TempSkillsDir;
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
    skills = createTempSkillsDir();
    vi.stubEnv(ENV_SKILLS_DIR, skills.path);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    skills.cleanup();
    home.cleanup();
  });

  it("windows the text listing rather than accepting --limit and ignoring it", async () => {
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsListCommand, { rawArgs: ["--format", "text", "--limit", "1"] });

    expect(stdout.chunks.join("")).toBe("alpha\n  The first skill.\n\n");
    expect(stderr.chunks.join("")).toBe(
      'Skills are unfiltered: there is no profile "default" (run `mb auth login` to create one and record its server).\n',
    );
  });

  it("reports `unavailable: null` in JSON when there is no cached probe to filter by", async () => {
    const stdout = capture(process.stdout);

    await runCommand(skillsListCommand, { rawArgs: ["--json"] });

    expect(stdout.parse(SkillListEnvelope)).toEqual({
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
      unavailable: null,
      data: [
        { name: "alpha", description: "The first skill." },
        { name: "beta", description: "The second skill." },
        { name: "gamma", description: "The git-sync skill." },
      ],
    });
  });

  it("leaves out a skill the cached server lacks a feature for and reports it under `unavailable`", async () => {
    await seedProbedProfile("default", probeAt(58));
    const stdout = capture(process.stdout);

    await runCommand(skillsListCommand, { rawArgs: ["--json"] });

    expect(stdout.parse(SkillListEnvelope)).toEqual({
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
      unavailable: [GAMMA_UNAVAILABLE_ON_58],
      data: [
        { name: "alpha", description: "The first skill." },
        { name: "beta", description: "The second skill." },
      ],
    });
  });

  it("names each skipped skill and the way to read it anyway in text mode", async () => {
    await seedProbedProfile("default", probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsListCommand, { rawArgs: ["--format", "text"] });

    expect(stdout.chunks.join("")).toBe(
      "alpha\n  The first skill.\n\nbeta\n  The second skill.\n\n",
    );
    expect(stderr.chunks.join("")).toBe(
      'Skipped skill "gamma": This operation requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase to use it. Pass --unfiltered to print it anyway.\n',
    );
  });

  it("names each skipped skill in a projected text listing too", async () => {
    await seedProbedProfile("default", probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsListCommand, { rawArgs: ["--format", "text", "--fields", "name"] });

    expect(stdout.chunks.join("")).toBe(
      [
        "┌───────┐",
        "│ name  │",
        "├───────┤",
        "│ alpha │",
        "├───────┤",
        "│ beta  │",
        "└───────┘",
        "",
      ].join("\n"),
    );
    expect(stderr.chunks.join("")).toBe(
      'Skipped skill "gamma": This operation requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase to use it. Pass --unfiltered to print it anyway.\n',
    );
  });

  it("lists every skill and reports nothing filtered when the server has the features", async () => {
    await seedProbedProfile("default", probeAt(61, { remote_sync: true }));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsListCommand, { rawArgs: ["--json"] });

    expect(stdout.parse(SkillListEnvelope)).toEqual({
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
      unavailable: [],
      data: [
        { name: "alpha", description: "The first skill." },
        { name: "beta", description: "The second skill." },
        { name: "gamma", description: "The git-sync skill." },
      ],
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("--unfiltered bypasses the filter and says nothing about it", async () => {
    await seedProbedProfile("default", probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsListCommand, { rawArgs: ["--unfiltered", "--json"] });

    expect(stdout.parse(SkillListEnvelope)).toEqual({
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
      unavailable: null,
      data: [
        { name: "alpha", description: "The first skill." },
        { name: "beta", description: "The second skill." },
        { name: "gamma", description: "The git-sync skill." },
      ],
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("reads the profile named by --profile", async () => {
    await seedProbedProfile("staging", probeAt(58));
    const stdout = capture(process.stdout);

    await runCommand(skillsListCommand, { rawArgs: ["--profile", "staging", "--json"] });

    expect(stdout.parse(SkillListEnvelope).unavailable).toEqual([GAMMA_UNAVAILABLE_ON_58]);
  });
});
