import { z } from "zod";

import { Session, type SessionCreateInput } from "../domain/session";
import {
  SessionProperties,
  type SessionSettings,
  sessionSettingsSchema,
} from "../domain/session-properties";
import type { ProbeReadOptions, RequestOptions, Transport } from "../http/transport";
import { profileFromProperties } from "../version/probe";

// A probe's reader is chosen before any profile exists, so this one picks the shape by the profile
// the answer it reads describes.
const SessionSettingsRead = SessionProperties.transform((properties, ctx): SessionSettings => {
  const { features } = profileFromProperties(properties);
  const parsed = sessionSettingsSchema(features).safeParse(properties);
  if (parsed.success) {
    return parsed.data;
  }
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ ...issue });
  }
  return z.NEVER;
});

export function sessionResource(transport: Transport) {
  /**
   * Get the session properties: the settings the caller may read, among them the server's version
   * and the premium features its license grants. Read afresh, never from a profile handed in.
   */
  async function properties(options: ProbeReadOptions = {}): Promise<SessionProperties> {
    return transport.probe(SessionProperties, options);
  }

  /**
   * Get the settings a bootstrap reads from the session properties: the setup state, the site name,
   * the AI and MCP switches and remote sync, parsed by the shape of the server that answers. Read
   * afresh, never from a profile handed in.
   */
  async function settings(options: ProbeReadOptions = {}): Promise<SessionSettings> {
    return transport.probe(SessionSettingsRead, options);
  }

  /**
   * Log in with a username and password, answering the new session's id. A wrong password answers
   * 401. An account with a second factor is answered with a challenge rather than a session, and
   * one without where the instance requires a second factor with an enrollment; this method
   * reports either as a `ResponseShapeError`.
   */
  async function create(
    params: SessionCreateInput,
    options: RequestOptions = {},
  ): Promise<Session> {
    return transport.requestParsed(Session, "/api/session", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { properties, settings, create };
}
