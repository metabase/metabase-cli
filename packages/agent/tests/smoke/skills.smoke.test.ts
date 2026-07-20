import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { metabaseSkillPaths } from "../../src/skills";
import { AGENT_TIMEOUT_MS, cleanupScratch, type Live, resolveLive, runAgent } from "./live";

const ReadArgs = z.object({ path: z.string() }).loose();

const live: Live | null = await resolveLive();

afterEach(cleanupScratch);

test.skipIf(live === null)(
  "reads the dashboard and visualization skills before planning a dashboard",
  async () => {
    const skillsRead = await skillsReadWhilePlanning(
      "Plan a sales dashboard for this instance: which charts, laid out how, and with which filters. Do not create anything yet — just tell me the plan.",
    );

    expect(skillsRead).toContain("dashboard");
  },
  AGENT_TIMEOUT_MS,
);

test.skipIf(live === null)(
  "reads the mbql skill before authoring a query",
  async () => {
    const skillsRead = await skillsReadWhilePlanning(
      "Write the MBQL query body that counts rows in a table of this instance, grouped by month. Show me the JSON — do not save a question.",
    );

    expect(skillsRead).toContain("mbql");
  },
  AGENT_TIMEOUT_MS,
);

async function skillsReadWhilePlanning(prompt: string): Promise<string[]> {
  if (live === null) {
    throw new Error("The skills smoke needs a model key, MB_URL, and MB_API_KEY.");
  }
  const run = await runAgent(live, prompt);
  const readPaths = run.toolCalls
    .filter((call) => call.name === "read")
    .map((call) => ReadArgs.parse(call.args).path);

  return metabaseSkillPaths()
    .filter((dir) => readPaths.some((path) => path.startsWith(dir)))
    .map((dir) => dir.split("/").at(-1) ?? dir);
}
