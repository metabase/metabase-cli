import {
  TaskRun,
  type TaskRunEntityType,
  type TaskRunStatus,
  type TaskRunType,
} from "../domain/task";
import type { Transport } from "../http/transport";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";
import { explainer } from "../version/refusal";

export interface TaskRunPageParams {
  "run-type"?: TaskRunType | undefined;
  "entity-type"?: TaskRunEntityType | undefined;
  "entity-id"?: number | undefined;
  status?: TaskRunStatus | undefined;
  /** A date range in the query processor's date-parameter syntax, constraining `started_at`. */
  "started-at"?: string | undefined;
}

export type TaskRunPageOptions = Omit<PaginateOptions, "query">;

export function taskResource(transport: Transport) {
  const { explainWalk } = explainer(transport, "task");

  /**
   * Walk the background-job runs, such as database syncs and subscription sends, newest first,
   * each with the name of the entity it ran against and a count of its tasks. Needs the monitoring
   * application permission.
   */
  async function* runPages(
    params: TaskRunPageParams = {},
    options: TaskRunPageOptions = {},
  ): AsyncIterable<Page<TaskRun>> {
    yield* paginatePages(transport, "/api/task/runs", TaskRun, {
      query: {
        "run-type": params["run-type"],
        "entity-type": params["entity-type"],
        "entity-id": params["entity-id"],
        status: params.status,
        "started-at": params["started-at"],
      },
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  return {
    runPages: explainWalk("runPages", runPages),
  };
}
