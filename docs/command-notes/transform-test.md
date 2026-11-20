## What can be tested

Only query transforms (native SQL or MBQL) can be tested, on Postgres, MySQL, H2, ClickHouse, Redshift or SQL Server. The server refuses any other transform with `transform-test.unsupported-transform`, and any other database with `transform-test.unsupported-driver`.

## Expectation rules

Expectation names are unique within a test. Expectation SQL may name only the transform's target table and its declared input tables, which are rewritten to the run's temp tables. Any other table is refused with `transform-test.unremapped-reference`, and so is a column qualified by a table name rather than an alias (`FROM people p … p.id` passes, `people.id` does not), in expectation SQL and in the transform's own SQL alike.
