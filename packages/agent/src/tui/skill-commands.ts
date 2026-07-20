import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

const SKILL_COMMAND_PREFIX = "/skill:";

function isSkillCommand(item: AutocompleteItem): boolean {
  return item.value.startsWith(SKILL_COMMAND_PREFIX);
}

export function withoutSkillCommands(
  suggestions: AutocompleteSuggestions | null,
): AutocompleteSuggestions | null {
  if (suggestions === null) {
    return null;
  }
  const items = suggestions.items.filter((item) => !isSkillCommand(item));
  if (items.length === suggestions.items.length) {
    return suggestions;
  }
  return { ...suggestions, items };
}

/**
 * The skills are the model's reference library — the MBQL grammar, the dashboard wiring — and pi's
 * resource loader is what puts their names and paths in front of it. Registering them there also
 * offers each one to the operator as `/skill:mbql`, which types a five-hundred-line grammar into the
 * conversation as though a human had written it. Nobody wants that; the agent reads them so nobody
 * has to. They stay loaded, and stop being advertised.
 */
export function metabaseSkillCommandsExtension() {
  return (pi: ExtensionAPI): void => {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") {
        return;
      }
      ctx.ui.addAutocompleteProvider(
        (current: AutocompleteProvider): AutocompleteProvider => ({
          ...current,
          getSuggestions: async (lines, cursorLine, cursorCol, options) =>
            withoutSkillCommands(
              await current.getSuggestions(lines, cursorLine, cursorCol, options),
            ),
          applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
            current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
        }),
      );
    });
  };
}
