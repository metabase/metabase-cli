import { CurrentUser } from "../domain/user";
import type { RequestOptions, Transport } from "../http/transport";

export function userResource(transport: Transport) {
  /** Get the user the request's credentials authenticate as. */
  async function current(options: RequestOptions = {}): Promise<CurrentUser> {
    await transport.require("user.current");
    return transport.requestParsed(CurrentUser, "/api/user/current", { ...options });
  }

  return { current };
}
