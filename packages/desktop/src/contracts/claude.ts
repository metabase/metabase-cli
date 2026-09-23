import { z } from "zod";

// What `claude auth status` prints. Loose because the binary adds fields between releases, and
// every field but `loggedIn` is optional because an older one omits them.
export const ClaudeAuthStatus = z
  .object({
    loggedIn: z.boolean(),
    authMethod: z.string().optional(),
    apiProvider: z.string().optional(),
    email: z.string().optional(),
    orgName: z.string().optional(),
  })
  .loose();
export type ClaudeAuthStatus = z.infer<typeof ClaudeAuthStatus>;
