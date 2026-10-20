import ts from "typescript";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  types: [],
  lib: ["lib.es2023.d.ts"],
  moduleDetection: ts.ModuleDetectionKind.Force,
};

interface CompileDiagnostic {
  readonly file: string | null;
  readonly line: number | null;
  readonly message: string;
}

export function compileTypeScript(files: ReadonlyMap<string, string>): CompileDiagnostic[] {
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.getSourceFile = (name, version, onError) => {
    const text = files.get(name);
    return text === undefined
      ? getSourceFile(name, version, onError)
      : ts.createSourceFile(name, text, version);
  };
  const program = ts.createProgram([...files.keys()], COMPILER_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map(toCompileDiagnostic);
}

function toCompileDiagnostic(diagnostic: ts.Diagnostic): CompileDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const { file, start } = diagnostic;
  if (file === undefined) {
    return { file: null, line: null, message };
  }
  const line = start === undefined ? null : file.getLineAndCharacterOfPosition(start).line + 1;
  return { file: file.fileName, line, message };
}
