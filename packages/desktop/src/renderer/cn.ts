import { createCn } from "cn/config";

// The names of the type scale in tokens.css. Without them the merge reads `text-meta` as a colour
// and drops it beside `text-ink-3`.
export const TYPE_SCALE = ["title", "body", "detail", "meta"] as const;

export const cn = createCn({ extend: { theme: { text: [...TYPE_SCALE] } } });
