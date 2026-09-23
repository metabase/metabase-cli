import { z } from "zod";

// The page runs under a CSP with no `unsafe-eval`, so Zod must not probe for the `Function`
// constructor before it builds a schema: the probe is refused and Chromium reports the refusal as
// a console error on a renderer that is working exactly as intended. This runs before the first
// schema is constructed, which is when Zod reads the flag.
//
// Zod installs its English messages as a side effect of its entry module, which its package.json
// declares free of side effects, so the renderer's bundle drops them and every message would read
// "Invalid input". Installing them here does not depend on what the bundler keeps.
z.config({ jitless: true, ...z.locales.en() });
