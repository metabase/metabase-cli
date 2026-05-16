import { describe, expect, it } from "vitest";

import {
  containerNameFor,
  DockerError,
  parseContainerLine,
  parseContainerLines,
  volumeNameFor,
} from "./docker";
import { MetabaseError } from "./errors";

describe("containerNameFor / volumeNameFor", () => {
  it("derives stable names from the workspace id", () => {
    expect(containerNameFor(7)).toBe("metabase-workspace-7");
    expect(volumeNameFor(7)).toBe("metabase-workspace-7-appdb");
  });
});

describe("parseContainerLine", () => {
  it("extracts workspace fields from a docker ps json line", () => {
    const line = JSON.stringify({
      ID: "abc123",
      Names: "metabase-workspace-12",
      State: "running",
      Status: "Up 5 minutes",
      Image: "metabase/metabase-enterprise:latest",
      Ports: "0.0.0.0:3100->3000/tcp",
      Labels:
        "com.metabase.workspace.id=12,com.metabase.workspace.name=analytics," +
        "com.metabase.workspace.profile=staging,com.metabase.workspace.parent=https://parent.example," +
        "com.metabase.workspace.image=metabase/metabase-enterprise:latest," +
        "com.metabase.workspace.host-port=3100",
    });
    expect(parseContainerLine(line)).toEqual({
      containerId: "abc123",
      name: "metabase-workspace-12",
      state: "running",
      status: "Up 5 minutes",
      image: "metabase/metabase-enterprise:latest",
      workspaceId: 12,
      workspaceName: "analytics",
      profile: "staging",
      parentUrl: "https://parent.example",
      hostPort: 3100,
    });
  });

  it("returns null when the workspace-id label is missing", () => {
    const line = JSON.stringify({
      ID: "abc",
      Names: "other-container",
      State: "running",
      Status: "Up",
      Image: "alpine",
      Ports: "",
      Labels: "com.example.unrelated=yes",
    });
    expect(parseContainerLine(line)).toBeNull();
  });

  it("treats a missing host-port label as null (not 0)", () => {
    const line = JSON.stringify({
      ID: "abc",
      Names: "metabase-workspace-3",
      State: "exited",
      Status: "Exited (0) 2 minutes ago",
      Image: "metabase/metabase-enterprise:latest",
      Ports: "",
      Labels: "com.metabase.workspace.id=3,com.metabase.workspace.name=demo",
    });
    expect(parseContainerLine(line)).toMatchObject({
      workspaceId: 3,
      workspaceName: "demo",
      profile: null,
      parentUrl: null,
      hostPort: null,
    });
  });

  it("rejects a workspace-id label that is not a positive integer", () => {
    const line = JSON.stringify({
      ID: "abc",
      Names: "metabase-workspace-bad",
      State: "running",
      Status: "Up",
      Image: "x",
      Ports: "",
      Labels: "com.metabase.workspace.id=not-a-number,com.metabase.workspace.name=w",
    });
    expect(parseContainerLine(line)).toBeNull();
  });

  it("throws when docker reports a state we do not recognize", () => {
    const line = JSON.stringify({
      ID: "abc",
      Names: "metabase-workspace-9",
      State: "phantom",
      Status: "?",
      Image: "x",
      Ports: "",
      Labels: "com.metabase.workspace.id=9,com.metabase.workspace.name=w",
    });
    expect(() => parseContainerLine(line)).toThrowError(
      'unknown docker container state: "phantom"',
    );
  });
});

describe("parseContainerLines", () => {
  it("ignores blank lines and orders results as docker emitted them", () => {
    const a = JSON.stringify({
      ID: "1",
      Names: "metabase-workspace-1",
      State: "running",
      Status: "Up",
      Image: "x",
      Ports: "",
      Labels: "com.metabase.workspace.id=1,com.metabase.workspace.name=a",
    });
    const b = JSON.stringify({
      ID: "2",
      Names: "metabase-workspace-2",
      State: "exited",
      Status: "Exited",
      Image: "x",
      Ports: "",
      Labels: "com.metabase.workspace.id=2,com.metabase.workspace.name=b",
    });
    const stdout = `${a}\n\n${b}\n`;
    const summaries = parseContainerLines(stdout);
    expect(summaries.map((s) => s.workspaceId)).toEqual([1, 2]);
  });
});

describe("DockerError", () => {
  it("is a MetabaseError with category=docker, exitCode=1", () => {
    const error = new DockerError("docker start failed for x", 125, "");
    expect(error).toBeInstanceOf(MetabaseError);
    expect(error.category).toBe("docker");
    expect(error.exitCode).toBe(1);
    expect(error.developerDetail).toEqual({ dockerExitCode: 125, stderr: "" });
  });

  it("userMessage falls back to the wrapper when stderr is empty", () => {
    const error = new DockerError("docker start failed for x", 125, "");
    expect(error.userMessage).toBe("docker start failed for x");
  });

  it("userMessage indents trimmed stderr beneath the wrapper", () => {
    const stderr =
      "docker: Error response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:3000 failed: port is already allocated.\n";
    const error = new DockerError("docker create failed for metabase-workspace-1", 125, stderr);
    expect(error.userMessage).toBe(
      "docker create failed for metabase-workspace-1\n" +
        "  docker: Error response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:3000 failed: port is already allocated.",
    );
  });
});
