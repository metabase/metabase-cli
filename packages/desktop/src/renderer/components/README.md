# Components

There are two `Button`s in this app and there will never be a third: the shadcn one in `ui/` for
forms, settings and dialogs, and the one in `agent/` for the agent surface. Both sit on the same
tokens, so the choice is about which surface you are building, never about how it looks. Everything
in this directory is a composite: it takes its colours, radii and shadows from `ui/`, `agent/` and
`tokens.css`, and never reaches for a raw hex, an arbitrary px value, a bare `<button>` or a bare
`<input>`.
