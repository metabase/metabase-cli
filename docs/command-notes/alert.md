## The alert commands read card alerts only

Metabase keeps its internal system-event notifications in the same API as question alerts, with ids alongside theirs. So `get`, `update`, `send` and `archive` refuse (exit 2) an id that names anything other than a card alert: sending one would fire an internal Metabase email.
