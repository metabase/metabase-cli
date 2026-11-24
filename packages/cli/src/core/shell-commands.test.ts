import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { shellCommands } from "./shell-commands";

function commandWords(script: string): (readonly string[])[] {
  return shellCommands(script).map((command) => command.words);
}

function singleQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

describe("shellCommands", () => {
  it("splits pipelines, lists and lines into commands", () => {
    expect(
      commandWords("cat a.json | mb card create && mb card list; mb uuid & mb eid\nmb auth status"),
    ).toEqual([
      ["cat", "a.json"],
      ["mb", "card", "create"],
      ["mb", "card", "list"],
      ["mb", "uuid"],
      ["mb", "eid"],
      ["mb", "auth", "status"],
    ]);
  });

  it("reads quotes and escapes into words", () => {
    expect(
      commandWords(`mb query --body '{"a": 1}' "two \\"words\\" $x" a\\ b --text="it's"`),
    ).toEqual([["mb", "query", "--body", '{"a": 1}', 'two "words" $x', "a b", "--text=it's"]]);
  });

  it("gives back every single-quoted word as it was", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (words) => {
        const script = ["mb", ...words.map(singleQuoted)].join(" ");
        expect(commandWords(script)).toEqual([["mb", ...words]]);
      }),
    );
  });

  it("reads the commands inside command substitutions", () => {
    expect(
      commandWords('TAG=$(mb data-app sdk-version --format text) && npm install "sdk@$TAG"'),
    ).toEqual([
      ["mb", "data-app", "sdk-version", "--format", "text"],
      ["npm", "install", "sdk@$TAG"],
    ]);
    expect(commandWords('[ "$(mb card list --json | jq -r ".has_more")" = true ]')).toEqual([
      ["mb", "card", "list", "--json"],
      ["jq", "-r", ".has_more"],
      ["[", "$(…)", "=", "true", "]"],
    ]);
  });

  it("reads the commands inside subshells and process substitutions", () => {
    expect(commandWords("(cd app && mb card list) ; diff <(mb card get 1) b.json")).toEqual([
      ["cd", "app"],
      ["mb", "card", "list"],
      ["mb", "card", "get", "1"],
      ["diff", "b.json"],
    ]);
  });

  it("leaves out the assignments and keywords that stand before a command", () => {
    expect(
      commandWords(
        "if ! MB_PROFILE=prod mb auth status; then mb auth login; fi\nwhile mb uuid; do :; done",
      ),
    ).toEqual([
      ["mb", "auth", "status"],
      ["mb", "auth", "login"],
      ["fi"],
      ["mb", "uuid"],
      [":"],
      ["done"],
    ]);
  });

  it("leaves out redirections", () => {
    expect(
      commandWords("mb auth login --api-key - < key.txt > out.txt 2>&1\nmb uuid 2>err.txt &>> log"),
    ).toEqual([
      ["mb", "auth", "login", "--api-key", "-"],
      ["mb", "uuid"],
    ]);
  });

  it("keeps a placeholder as a word or as part of one", () => {
    expect(commandWords("mb card get <card-id> --profile=<name>")).toEqual([
      ["mb", "card", "get", "<card-id>", "--profile=<name>"],
    ]);
  });

  it("leaves out comments, but not a `#` inside a word", () => {
    expect(commandWords("# mb one\nmb uuid # mb two\nmb get a#b")).toEqual([
      ["mb", "uuid"],
      ["mb", "get", "a#b"],
    ]);
  });

  it("leaves out the body of a here-document", () => {
    const script = [
      "cat > body.json <<'EOF' && mb card list",
      "mb is text here, and so is an unclosed ' quote",
      "EOF",
      "mb card create --file body.json",
    ].join("\n");

    expect(commandWords(script)).toEqual([
      ["cat"],
      ["mb", "card", "list"],
      ["mb", "card", "create", "--file", "body.json"],
    ]);
  });

  it("ends a tab-stripping here-document at its indented delimiter", () => {
    expect(commandWords("cat <<-EOF\n\ttext\n\tEOF\nmb uuid")).toEqual([["cat"], ["mb", "uuid"]]);
  });

  it("joins a line that ends in a backslash to the next", () => {
    expect(commandWords("mb card list \\\n  --json \\\n  | jq .")).toEqual([
      ["mb", "card", "list", "--json"],
      ["jq", "."],
    ]);
  });

  it("reads a carriage return as a blank", () => {
    expect(commandWords("mb uuid\r\nmb eid\r")).toEqual([
      ["mb", "uuid"],
      ["mb", "eid"],
    ]);
  });

  it("names the line each command starts on, counted from the line given", () => {
    expect(shellCommands("mb uuid\n\nmb card list \\\n  | mb eid", 20)).toEqual([
      { words: ["mb", "uuid"], line: 20 },
      { words: ["mb", "card", "list"], line: 22 },
      { words: ["mb", "eid"], line: 23 },
    ]);
  });

  it.each([
    ["mb query --body '{}", "line 1: `'` is never closed"],
    ['mb uuid\nmb query "x', 'line 2: `"` is never closed'],
    ["U=$(mb uuid", "line 1: `(` is never closed"],
    ["mb uuid)", "line 1: `)` closes nothing"],
    ["U=`mb uuid`", "line 1: write a command substitution as `$(…)`, not in backticks"],
    ["cat <<EOF\ntext", "line 2: the here-document that ends at EOF is never closed"],
  ])("refuses a script it can't read: %j", (script, message) => {
    expect(() => shellCommands(script)).toThrow(ConfigError);
    expect(() => shellCommands(script)).toThrow(new ConfigError(message));
  });
});
