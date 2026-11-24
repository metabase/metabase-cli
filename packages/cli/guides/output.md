---
title: "Read and page through output"
summary: "How list and get commands print what they find, and how to narrow it, cap it, and read the rest."
---

A `list` or `get` command prints a short form of what it finds: text on a terminal, and JSON everywhere else. The [output flags](../index.md#output-flags) change what it prints, and the [list flags](../index.md#list-flags) choose the part of a list that it prints.

## Choose the format

To get JSON on a terminal, pass `--json`. To get text in a script, pass `--format text`.

```sh
mb card list --json
mb card get <card-id> --format text
```

## Choose the fields

By default, a command prints a compact form of each item. Pass `--full` to get every field, or `--fields` to get the fields you name. You can't use both.

```sh
mb card get <card-id> --full
mb card list --fields id,name,collection_id
```

On a list, the paths you give `--fields` start at each item in `data`. On a single item, they start at the item.

## Cap the output

`--max-bytes` limits how much a command prints. `--max-bytes 0` removes the limit. What happens at the limit depends on the command:

- A list drops items from its end, and sets `truncated` in its answer.
- A command that prints one item fails with exit code `2`. Narrow it with `--fields`, or raise the limit.

## Page through a list

Every `list` command answers with the same envelope:

```json
{
  "returned": 2,
  "offset": 0,
  "limit": 2,
  "total": 42,
  "has_more": true,
  "next_offset": 2,
  "data": []
}
```

| Field         | Meaning                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `data`        | The items in this window.                                                                          |
| `returned`    | How many items are in `data`.                                                                      |
| `offset`      | Where the window starts.                                                                           |
| `limit`       | The limit of the window. Left out when there is none.                                              |
| `total`       | The server's count, or `null` when the server doesn't report one.                                  |
| `has_more`    | Whether more items remain.                                                                         |
| `next_offset` | The `--offset` of the next window, or `null` when there is nothing to resume from.                 |
| `truncated`   | Set when `--max-bytes` dropped items. Its `bytes` is the size that the full answer would have had. |

To read a whole list, pass each `next_offset` back as `--offset` until `has_more` is `false`:

```sh
offset=0
while : ; do
  page=$(mb card list --limit 50 --offset "$offset" --fields id,name --json)
  echo "$page" | jq -c '.data[]'
  [ "$(echo "$page" | jq -r '.has_more')" = "true" ] || break
  offset=$(echo "$page" | jq -r '.next_offset')
done
```

Stop on `has_more`, not on a count. `total` can be `null`, and it can be different from the number of items that you can read.

If no item fits in the `--max-bytes` limit, `data` is empty, `has_more` is `true`, and `next_offset` is `null`. Narrow the items with `--fields`, or raise the limit.
