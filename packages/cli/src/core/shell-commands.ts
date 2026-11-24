import { ConfigError } from "@metabase/client/errors";

// One simple command of a shell script: the words it runs, with the quotes read and the
// assignments and keywords before it left out.
export interface ShellCommand {
  words: readonly string[];
  // The line of the text that holds the script.
  line: number;
}

interface Heredoc {
  delimiter: string;
  stripsTabs: boolean;
}

const BLANK = /[^\S\n]/;
const WORD_END = /[\s|&;()<>]/;
const OPERATOR = /[|&;]/;
// A documented command writes an argument the reader fills in as `<id>`, which a shell would read
// as two redirections.
const PLACEHOLDER = /<[A-Za-z][\w.-]*>/y;
const FILE_DESCRIPTOR = /\d+(?=[<>])/y;
const REDIRECTION = /&>>?|<<<|<<-?|<&|<>|>>|>&|>\||<|>/y;
const HEREDOC = "<<";
const HEREDOC_STRIPPING_TABS = "<<-";
const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/;
const DOUBLE_QUOTE_ESCAPES: ReadonlySet<string> = new Set(["$", "`", '"', "\\", "\n"]);
// The words that stand before a command rather than run as one.
const LEADING_KEYWORDS: ReadonlySet<string> = new Set([
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
  "!",
  "{",
  "time",
]);
// What a command substitution stands as in the word that holds it.
const SUBSTITUTION = "$(…)";

/**
 * Every simple command a shell script runs, the ones in pipelines, lists, subshells and command
 * substitutions included. Comments, redirections and here-documents are left out. `firstLine` is
 * the line the script starts on in the text that holds it.
 */
export function shellCommands(script: string, firstLine = 1): ShellCommand[] {
  return new ShellReader(script, firstLine).read();
}

class ShellReader {
  private readonly commands: ShellCommand[] = [];
  private readonly heredocs: Heredoc[] = [];
  private position = 0;

  constructor(
    private readonly script: string,
    private readonly firstLine: number,
  ) {}

  read(): ShellCommand[] {
    this.readList(null);
    return this.commands;
  }

  // Reads up to the `)` that closes a subshell or substitution, or to the end of the script.
  private readList(openedAt: number | null): void {
    let words: string[] = [];
    let line = this.lineNumber();
    const finish = (): void => {
      this.addCommand(words, line);
      words = [];
    };
    while (this.position < this.script.length) {
      const char = this.current();
      if (char === "\n") {
        finish();
        this.position += 1;
        this.skipHeredocs();
      } else if (this.startsWith("\\\n")) {
        this.position += 2;
      } else if (BLANK.test(char)) {
        this.position += 1;
      } else if (char === "#") {
        this.skipComment();
      } else if (char === ")") {
        if (openedAt === null) {
          throw this.refusal("`)` closes nothing", this.position);
        }
        finish();
        this.position += 1;
        return;
      } else if (this.skipRedirection()) {
        continue;
      } else if (char === "(") {
        finish();
        this.readParenthesis(1);
      } else if (OPERATOR.test(char)) {
        finish();
        this.position += 1;
      } else {
        if (words.length === 0) {
          line = this.lineNumber();
        }
        words.push(this.readWord());
      }
    }
    if (openedAt !== null) {
      throw this.refusal("`(` is never closed", openedAt);
    }
    finish();
  }

  private addCommand(words: readonly string[], line: number): void {
    const start = words.findIndex((word) => !LEADING_KEYWORDS.has(word) && !ASSIGNMENT.test(word));
    if (start >= 0) {
      this.commands.push({ words: words.slice(start), line });
    }
  }

  private readParenthesis(openingLength: number): void {
    const openedAt = this.position;
    this.position += openingLength;
    this.readList(openedAt);
  }

  private readWord(): string {
    let word = "";
    while (this.position < this.script.length) {
      const char = this.current();
      const placeholder = this.match(PLACEHOLDER);
      if (placeholder !== null) {
        word += placeholder;
      } else if (WORD_END.test(char)) {
        return word;
      } else if (char === "'") {
        word += this.readUntil("'", this.position + 1);
      } else if (char === '"') {
        word += this.readDoubleQuoted();
      } else if (char === "\\") {
        word += this.readEscape();
      } else {
        word += this.readExpansion() ?? this.take();
      }
    }
    return word;
  }

  private readDoubleQuoted(): string {
    const openedAt = this.position;
    let text = "";
    this.position += 1;
    while (this.position < this.script.length) {
      const char = this.current();
      if (char === '"') {
        this.position += 1;
        return text;
      }
      if (char === "\\" && DOUBLE_QUOTE_ESCAPES.has(this.script.charAt(this.position + 1))) {
        text += this.readEscape();
      } else {
        text += this.readExpansion() ?? this.take();
      }
    }
    throw this.refusal('`"` is never closed', openedAt);
  }

  private readExpansion(): string | null {
    if (this.current() === "`") {
      throw this.refusal("write a command substitution as `$(…)`, not in backticks", this.position);
    }
    if (this.startsWith("$(")) {
      this.readParenthesis(2);
      return SUBSTITUTION;
    }
    if (this.startsWith("${")) {
      return `\${${this.readUntil("}", this.position + 2)}}`;
    }
    return null;
  }

  // An escaped line break joins the lines.
  private readEscape(): string {
    this.position += 1;
    const escaped = this.take();
    return escaped === "\n" ? "" : escaped;
  }

  private readUntil(closing: string, start: number): string {
    const end = this.script.indexOf(closing, start);
    if (end < 0) {
      throw this.refusal(`\`${this.current()}\` is never closed`, this.position);
    }
    this.position = end + closing.length;
    return this.script.slice(start, end);
  }

  private skipRedirection(): boolean {
    if (this.matchAhead(PLACEHOLDER) !== null) {
      return false;
    }
    if (this.startsWith("<(") || this.startsWith(">(")) {
      this.readParenthesis(2);
      return true;
    }
    this.match(FILE_DESCRIPTOR);
    const operator = this.match(REDIRECTION);
    if (operator === null) {
      return false;
    }
    while (BLANK.test(this.current())) {
      this.position += 1;
    }
    const target = this.readWord();
    if (operator === HEREDOC || operator === HEREDOC_STRIPPING_TABS) {
      const stripsTabs = operator === HEREDOC_STRIPPING_TABS;
      this.heredocs.push({ delimiter: target, stripsTabs });
    }
    return true;
  }

  private skipHeredocs(): void {
    for (const heredoc of this.heredocs.splice(0)) {
      this.skipHeredoc(heredoc);
    }
  }

  private skipHeredoc({ delimiter, stripsTabs }: Heredoc): void {
    const openedAt = this.position;
    while (this.position < this.script.length) {
      const line = this.readLine();
      if ((stripsTabs ? line.replace(/^\t+/, "") : line) === delimiter) {
        return;
      }
    }
    throw this.refusal(`the here-document that ends at ${delimiter} is never closed`, openedAt);
  }

  private readLine(): string {
    const lineEnd = this.script.indexOf("\n", this.position);
    const end = lineEnd < 0 ? this.script.length : lineEnd;
    const line = this.script.slice(this.position, end);
    this.position = Math.min(end + 1, this.script.length);
    return line;
  }

  private skipComment(): void {
    const lineEnd = this.script.indexOf("\n", this.position);
    this.position = lineEnd < 0 ? this.script.length : lineEnd;
  }

  private match(pattern: RegExp): string | null {
    const found = this.matchAhead(pattern);
    this.position += found?.length ?? 0;
    return found;
  }

  private matchAhead(pattern: RegExp): string | null {
    pattern.lastIndex = this.position;
    return pattern.exec(this.script)?.[0] ?? null;
  }

  private startsWith(text: string): boolean {
    return this.script.startsWith(text, this.position);
  }

  private current(): string {
    return this.script.charAt(this.position);
  }

  private take(): string {
    const char = this.current();
    this.position += 1;
    return char;
  }

  private lineNumber(at = this.position): number {
    return this.firstLine + this.script.slice(0, at).split("\n").length - 1;
  }

  private refusal(message: string, at: number): ConfigError {
    return new ConfigError(`line ${this.lineNumber(at)}: ${message}`);
  }
}
