import { z } from "zod";

import { NOT_BLANK } from "../predicates";

// The server refuses a blank string, Java whitespace only included. A pattern rather than a
// refinement, so an input's JSON Schema carries the rule too.
export const NonBlankText = z.string().regex(NOT_BLANK, "must not be blank");
