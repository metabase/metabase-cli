## A document is a TipTap JSON tree

A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed` nodes) and inline links to Metabase entities (`smartLink` nodes). Its body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree, stored with `content_type` `application/json+vnd.prose-mirror`. Documents need no premium token.

## Each block node needs an id

[mb document create](#mb-document-create) and [mb document update](#mb-document-update) refuse a body in which a `paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed` or `supportingText` node has no `_id`, a UUID. Without one, the document opens with a spurious "unsaved changes" prompt. Mint ids with [mb uuid](uuid.md). Other node types take no `_id`.
