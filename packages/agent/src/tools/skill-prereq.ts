const SKILL_NAMES = [
  "mbql",
  "native-sql",
  "dashboard",
  "visualization",
  "metadata",
  "transform",
  "document",
  "git-sync",
  "library",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export function readSkillsFirst(skills: readonly SkillName[]): string {
  return `Read ${listSkills(skills)} before composing a body for this tool for the first time in a session. The exact shape is not guessable: a body assembled from intuition gets rejected by the server, not repaired by it.`;
}

export function skillsAfterRejection(skills: readonly SkillName[]): string {
  return `Metabase rejected the body as malformed. Read ${listSkills(skills)} and check the body against the grammar before retrying — an adjusted guess earns another rejection.`;
}

function listSkills(skills: readonly SkillName[]): string {
  const named = skills.map((skill) => `the \`${skill}\` skill`);
  if (named.length <= 1) {
    return named.join("");
  }
  return `${named.slice(0, -1).join(", ")} and ${named.slice(-1).join("")}`;
}
