## Collections

Collections are the folders that hold cards, dashboards, and other collections. [mb collection list](#mb-collection-list) includes the virtual root collection, **Our analytics**, whose id is the string `"root"`, beside the numeric ids of the others.

## Moving, trashing, and restoring

[mb collection update](#mb-collection-update) with `--archived false` (or `"archived": false` in a body) restores an archived collection to its old location, or, with `--parent-id`, under that parent. `--parent-id` alone moves an archived collection and leaves it in the trash.

The server ignores `parent_id` in a request that trashes a collection. So `--archived true` with `--parent-id` on a collection that is not in the trash is sent as two requests: the move, with every other change, and then the trash. If the second one fails, the error says that the collection was moved but not trashed.

A collection enters the trash only by being trashed. Whenever `--parent-id` is a collection id, the CLI looks up the trash with one more request. A `--parent-id` that names the trash is read as the trash alone with `--archived true`, and is refused otherwise.

## Official collections

Setting or clearing `authority_level` (`"official"`) needs an admin and the Official Collections feature (Pro and Enterprise). Without the feature, the server answers 402. Sending the value that the collection already has is no change, and passes on any instance.
