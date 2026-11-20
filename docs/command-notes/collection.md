## Collections are folders

Collections are the folders that hold cards, dashboards, and other collections. [mb collection list](#mb-collection-list) includes the virtual root collection, **Our analytics**, whose id is the string `"root"`, beside the numeric ids of the others.

## Restore a collection with `--archived false`

[mb collection update](#mb-collection-update) with `--archived false` (or `"archived": false` in a body) restores an archived collection to its old location, or, with `--parent-id`, under that parent. `--parent-id` alone moves an archived collection and leaves it in the trash.

`--archived true` with `--parent-id` moves the collection and then trashes it, in two requests, since the server ignores `parent_id` when it trashes. If the second request fails, the error says that the collection moved but isn't in the trash.

A `--parent-id` that names the trash is refused, except with `--archived true`, where it only trashes the collection.

## Official collections need an admin and a Pro or Enterprise plan

Setting or clearing `authority_level` (`"official"`) needs an admin and the Official Collections feature; without the feature, the server answers 402. Sending the value the collection already has changes nothing, and works on any instance.
