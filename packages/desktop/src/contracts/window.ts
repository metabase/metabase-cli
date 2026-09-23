import { z } from "zod";

// Where the operating system draws the window's own buttons over the app's top strip. macOS puts
// the traffic lights in the leading corner and the app keeps `inset` pixels clear for them; the
// window controls overlay on Windows and Linux takes the trailing corner and reports its own area
// to the page through the `titlebar-area-*` CSS environment variables.
export const WindowChrome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("traffic-lights"), inset: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("controls-overlay") }).strict(),
]);
export type WindowChrome = z.infer<typeof WindowChrome>;
