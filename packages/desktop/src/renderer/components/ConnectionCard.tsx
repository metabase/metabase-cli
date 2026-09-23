import type { FormEvent, ReactElement } from "react";
import { useEffect, useState } from "react";

import type { AuthMethod, ConnectOutcome, ConnectionState } from "../../contracts/connection";
import type { ConnectedUser, ServerSummary } from "../../contracts/settings";
import { assertNever } from "../../contracts/assert-never";
import { rde } from "@/bridge";
import type { RequestState } from "@/request";
import { requestFailure, useRequest } from "@/request";

import { Detail } from "./Detail";
import { Note } from "./Note";
import { SettingsCard } from "./SettingsCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

const URL_FIELD_ID = "metabase-url";
const API_KEY_FIELD_ID = "metabase-api-key";
const URL_PLACEHOLDER = "https://metabase.example.com";
const NO_API_KEY = null;

interface ConnectionCardProps {
  readonly connection: ConnectionState;
  readonly onConnection: (connection: ConnectionState) => void;
}

export function ConnectionCard({ connection, onConnection }: ConnectionCardProps): ReactElement {
  return (
    <SettingsCard section="metabase" status={null}>
      <ConnectionBody connection={connection} onConnection={onConnection} />
    </SettingsCard>
  );
}

function ConnectionBody({ connection, onConnection }: ConnectionCardProps): ReactElement {
  switch (connection.kind) {
    case "disconnected": {
      return <SignInForm initialUrl="" action="Sign in" onConnection={onConnection} />;
    }
    case "connected": {
      return (
        <>
          <Profile user={connection.user} url={connection.url} server={connection.server} />
          <SignOutButton onConnection={onConnection} />
        </>
      );
    }
    case "stale": {
      return (
        <>
          <Profile user={connection.user} url={connection.url} server={connection.server} />
          <Note tone="warning">{connection.reason}</Note>
          <div className="flex gap-2">
            <ReachAgainButton onConnection={onConnection} />
            <SignOutButton onConnection={onConnection} />
          </div>
        </>
      );
    }
    case "signed-out": {
      return (
        <>
          <Identity user={connection.user} />
          <Note tone="warning">{connection.reason}</Note>
          <SignInForm
            initialUrl={connection.url}
            action="Sign in again"
            onConnection={onConnection}
          />
        </>
      );
    }
    default: {
      return assertNever(connection);
    }
  }
}

interface IdentityProps {
  readonly user: ConnectedUser;
}

function Identity({ user }: IdentityProps): ReactElement {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-body font-medium text-ink">{user.name}</p>
        <p className="truncate text-detail text-ink-2">{user.email}</p>
      </div>
      <Badge variant={user.isSuperuser ? "secondary" : "outline"}>
        {user.isSuperuser ? "Admin" : "Member"}
      </Badge>
    </div>
  );
}

interface ProfileProps {
  readonly user: ConnectedUser;
  readonly url: string;
  readonly server: ServerSummary;
}

function Profile({ user, url, server }: ProfileProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Identity user={user} />
      <Detail label="URL" value={url} mono={false} />
      {server.version === null ? null : (
        <Detail label="Version" value={server.version} mono={false} />
      )}
    </div>
  );
}

interface SignOutButtonProps {
  readonly onConnection: (connection: ConnectionState) => void;
}

function SignOutButton({ onConnection }: SignOutButtonProps): ReactElement {
  const signOut = useRequest<ConnectionState>();
  const running = signOut.state.status === "running";
  const failure = requestFailure(signOut.state);

  const startSignOut = (): void => {
    void signOut.send(async () => {
      const next = await rde.connectionSignOut();
      onConnection(next);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="ghost" size="sm" disabled={running} onClick={startSignOut}>
          {running ? <Spinner label="Signing out" /> : "Sign out"}
        </Button>
      </div>
      {failure === null ? null : <Note tone="error">{failure}</Note>}
    </div>
  );
}

interface ReachAgainButtonProps {
  readonly onConnection: (connection: ConnectionState) => void;
}

function ReachAgainButton({ onConnection }: ReachAgainButtonProps): ReactElement {
  const reach = useRequest<ConnectionState>();
  const running = reach.state.status === "running";
  const failure = requestFailure(reach.state);

  const reachAgain = (): void => {
    void reach.send(async () => {
      const next = await rde.connectionRefresh();
      onConnection(next);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" disabled={running} onClick={reachAgain}>
        {running ? <Spinner label="Reaching" /> : "Try again"}
      </Button>
      {failure === null ? null : <Note tone="error">{failure}</Note>}
    </div>
  );
}

interface SignInFormProps {
  readonly initialUrl: string;
  readonly action: string;
  readonly onConnection: (connection: ConnectionState) => void;
}

function SignInForm({ initialUrl, action, onConnection }: SignInFormProps): ReactElement {
  const [url, setUrl] = useState(initialUrl);
  const [apiKey, setApiKey] = useState("");
  const probe = useRequest<AuthMethod>();
  const connect = useRequest<ConnectOutcome>();
  const target = url.trim();
  const probing = probe.state.status === "running";
  const connecting = connect.state.status === "running";
  const probeFailure = requestFailure(probe.state);
  const connectionFailure = connectFailure(connect.state);

  const sendProbe = probe.send;

  // Signing in again starts from the address the app already knows, so it is checked at once.
  useEffect(() => {
    if (initialUrl.length > 0) {
      void sendProbe(() => rde.connectionProbe({ url: initialUrl }));
    }
  }, [initialUrl, sendProbe]);

  const probeTarget = (): void => {
    if (target.length === 0) {
      return;
    }
    void probe.send(() => rde.connectionProbe({ url: target }));
  };

  const submitUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    probeTarget();
  };

  const connectWith = (credential: string | null): void => {
    void connect.send(async () => {
      const outcome = await rde.connectionConnect({ url: target, apiKey: credential });
      if (outcome.kind === "connected") {
        onConnection(outcome);
      }
      return outcome;
    });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submitUrl}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={URL_FIELD_ID}>Metabase URL</Label>
        <div className="flex gap-2">
          <Input
            id={URL_FIELD_ID}
            type="url"
            value={url}
            placeholder={URL_PLACEHOLDER}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onBlur={probeTarget}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={probing || target.length === 0}
          >
            {probing ? <Spinner label="Checking" /> : "Check URL"}
          </Button>
        </div>
      </div>
      {probeFailure === null ? null : <Note tone="error">{probeFailure}</Note>}
      {probe.state.status === "ready" ? (
        <AuthMethodFields
          method={probe.state.value}
          action={action}
          apiKey={apiKey}
          connecting={connecting}
          onApiKey={setApiKey}
          onConnect={connectWith}
        />
      ) : null}
      {connectionFailure === null ? null : <Note tone="error">{connectionFailure}</Note>}
    </form>
  );
}

interface AuthMethodFieldsProps {
  readonly method: AuthMethod;
  readonly action: string;
  readonly apiKey: string;
  readonly connecting: boolean;
  readonly onApiKey: (apiKey: string) => void;
  readonly onConnect: (credential: string | null) => void;
}

function AuthMethodFields({
  method,
  action,
  apiKey,
  connecting,
  onApiKey,
  onConnect,
}: AuthMethodFieldsProps): ReactElement {
  switch (method.kind) {
    case "oauth": {
      return (
        <OAuthFields
          action={action}
          apiKey={apiKey}
          connecting={connecting}
          onApiKey={onApiKey}
          onConnect={onConnect}
        />
      );
    }
    case "apiKey": {
      return (
        <div className="flex flex-col gap-1.5">
          <Note tone="info">{method.reason}</Note>
          <ApiKeyField
            action={action}
            apiKey={apiKey}
            connecting={connecting}
            onApiKey={onApiKey}
            onConnect={onConnect}
          />
        </div>
      );
    }
    case "unreachable": {
      return <Note tone="error">{method.message}</Note>;
    }
    default: {
      return assertNever(method);
    }
  }
}

type CredentialFieldsProps = Omit<AuthMethodFieldsProps, "method">;

// A person holding a key an admin issued can still use it on a server that offers the browser
// sign-in.
function OAuthFields(props: CredentialFieldsProps): ReactElement {
  const [keyChosen, setKeyChosen] = useState(false);
  if (keyChosen) {
    return (
      <div className="flex flex-col gap-1.5">
        <ApiKeyField {...props} />
        <div>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              setKeyChosen(false);
            }}
          >
            Sign in with the browser instead
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        disabled={props.connecting}
        onClick={() => {
          props.onConnect(NO_API_KEY);
        }}
      >
        {props.connecting ? <Spinner label="Signing in" /> : props.action}
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => {
          setKeyChosen(true);
        }}
      >
        Use an API key instead
      </Button>
    </div>
  );
}

function ApiKeyField({
  action,
  apiKey,
  connecting,
  onApiKey,
  onConnect,
}: CredentialFieldsProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={API_KEY_FIELD_ID}>API key</Label>
      <div className="flex gap-2">
        <Input
          id={API_KEY_FIELD_ID}
          type="password"
          value={apiKey}
          onChange={(event) => {
            onApiKey(event.target.value);
          }}
        />
        <Button
          type="button"
          disabled={connecting || apiKey.length === 0}
          onClick={() => {
            onConnect(apiKey);
          }}
        >
          {connecting ? <Spinner label="Signing in" /> : action}
        </Button>
      </div>
    </div>
  );
}

function connectFailure(state: RequestState<ConnectOutcome>): string | null {
  const rejected = requestFailure(state);
  if (rejected !== null) {
    return rejected;
  }
  if (state.status === "ready" && state.value.kind === "failed") {
    return state.value.message;
  }
  return null;
}
