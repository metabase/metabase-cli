## Card alerts only

Metabase keeps its internal system-event notifications in the same API as question alerts, with ids alongside theirs. `get`, `update`, `send` and `archive` refuse an id that names any notification other than a card alert (exit 2): reading one as an alert would mislead, and sending one would fire an internal Metabase email.
