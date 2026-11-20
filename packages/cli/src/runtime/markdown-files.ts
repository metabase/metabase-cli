import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { isFileNotFoundError } from "@metabase/client/errors";

const MARKDOWN_EXTENSION = ".md";

interface MarkdownFile {
  name: string;
  text: string;
}

// Each Markdown file directly in `dir`, by file name. A folder that does not exist holds none.
export async function readMarkdownFiles(dir: string): Promise<ReadonlyMap<string, string>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return new Map();
    }
    throw error;
  }
  const markdown = names.filter((name) => name.endsWith(MARKDOWN_EXTENSION)).toSorted();
  const files = await Promise.all(markdown.map((name) => readMarkdownFile(dir, name)));
  return new Map(files.map((file) => [file.name, file.text]));
}

async function readMarkdownFile(dir: string, name: string): Promise<MarkdownFile> {
  return { name, text: await readFile(join(dir, name), "utf8") };
}
