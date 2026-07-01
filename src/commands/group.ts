import { defineCommand } from "citty";
import type { CommandDef, CommandMeta, SubCommandsDef } from "citty";

import { setMetabaseAugment, type SkillPointer } from "../runtime/command-augment";

export interface CommandGroupDef {
  name: string;
  description: string;
  alias?: string;
  defaultCommand?: string;
  skills?: readonly SkillPointer[];
  subCommands: SubCommandsDef;
}

export function defineCommandGroup(def: CommandGroupDef): CommandDef {
  const meta: CommandMeta = { name: def.name, description: def.description };
  if (def.alias !== undefined) {
    meta.alias = def.alias;
  }
  const commandDef: CommandDef = { meta, subCommands: def.subCommands };
  if (def.defaultCommand !== undefined) {
    commandDef.default = def.defaultCommand;
  }
  const cmd = defineCommand(commandDef);
  setMetabaseAugment(cmd, {
    examples: [],
    details: null,
    skills: def.skills ?? [],
    outputSchema: null,
    capabilities: null,
  });
  return cmd;
}
