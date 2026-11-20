## Tags group transforms and jobs

Tags group transforms and jobs. A transform or a job names its tags by id in its `tag_ids` field (see [`mb transform update`](transform.md#mb-transform-update) and [`mb transform-job update`](transform-job.md#mb-transform-job-update)). The four built-in tags, `hourly`, `daily`, `weekly` and `monthly`, drive the four built-in jobs.

There's no command to get one tag by id: read it from [`mb transform-tag list`](#mb-transform-tag-list).
