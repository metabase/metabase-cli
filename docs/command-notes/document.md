## Documents

A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed` nodes) and inline links to Metabase entities (`smartLink` nodes). Its body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree, stored with `content_type` `application/json+vnd.prose-mirror`. Documents are a baseline open-source feature: they need no premium token.

## Node ids

For a document to open clean, with no spurious "unsaved changes" prompt, each `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed` and `supportingText` node carries its own `_id`, a UUID. [mb document create](#mb-document-create) and [mb document update](#mb-document-update) refuse a body in which one of these nodes has none. Mint ids with [mb uuid](uuid.md). Other node types take no `_id`.
