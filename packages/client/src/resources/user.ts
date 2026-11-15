import { z } from "zod";

import { CurrentUser, User, type UserCreateInput, type UserListStatus } from "../domain/user";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

const UserList = z.object({
  data: z.array(User),
  total: z.number().int().nonnegative(),
});

export interface UserListParams {
  /** Which accounts to include by activation; `active` when absent. Only an admin may widen it. */
  status?: UserListStatus | undefined;
  /** Matches the first name, last name or email. */
  query?: string | undefined;
  group_id?: number | undefined;
}

export function userResource(transport: Transport) {
  /** Get the user the request's credentials authenticate as. */
  async function current(options: RequestOptions = {}): Promise<CurrentUser> {
    return transport.requestParsed(CurrentUser, "/api/user/current", { ...options });
  }

  /**
   * List the users, ordered by first name. Needs an admin, a data analyst or a group manager, who
   * sees the members of the groups they manage; a sandboxed user sees only themselves. Which
   * columns each user carries depends on the caller, as `User` says.
   */
  async function list(
    params: UserListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<User>> {
    const response = await transport.requestParsed(UserList, "/api/user", {
      ...options,
      query: { status: params.status, query: params.query, group_id: params.group_id },
    });
    return { data: response.data, total: response.total };
  }

  /**
   * Create a user and send the invite. Admin only. Without a password the account gets a random
   * one, so it can sign in only through the invite. A taken email answers 400 naming `email`.
   */
  async function create(params: UserCreateInput, options: RequestOptions = {}): Promise<User> {
    return transport.requestParsed(User, "/api/user", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { current, list, create };
}
