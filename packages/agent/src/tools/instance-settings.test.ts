import { expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { runInstanceSettingsTool } from "./instance-settings";
import { TeachingError } from "./teaching-error";

interface SettingOverrides {
  key: string;
  value: unknown;
  is_env_setting?: boolean;
  env_name?: string;
}

function setting({
  key,
  value,
  is_env_setting = false,
  env_name = `MB_${key.toUpperCase().replaceAll("-", "_")}`,
}: SettingOverrides): unknown {
  return {
    key,
    value,
    is_env_setting,
    env_name,
    description: `The ${key} setting`,
    default: null,
  };
}

const SETTINGS: Responder = () => [
  setting({ key: "site-name", value: "Acme Analytics" }),
  setting({ key: "report-timezone", value: "UTC" }),
  setting({ key: "site-url", value: "https://mb.example.com", is_env_setting: true }),
];

test("list narrows by substring and projects each setting compactly", async () => {
  const { deps, requests } = toolDeps(SETTINGS);

  const result = await runInstanceSettingsTool(deps, { action: "list", filter: "site" });

  expect(requests).toEqual([{ path: "/api/setting", method: "GET", options: undefined }]);
  expect(result.details).toEqual({
    kind: "list",
    noun: "settings",
    envelope: {
      data: [
        {
          key: "site-name",
          value: "Acme Analytics",
          is_env_setting: false,
          env_name: "MB_SITE_NAME",
        },
        {
          key: "site-url",
          value: "https://mb.example.com",
          is_env_setting: true,
          env_name: "MB_SITE_URL",
        },
      ],
      returned: 2,
      total: 2,
    },
  });
});

test("set writes the value as JSON", async () => {
  const { deps, requests } = toolDeps(SETTINGS);

  const result = await runInstanceSettingsTool(deps, {
    action: "set",
    key: "report-timezone",
    value: "Europe/Berlin",
  });

  expect(requests).toEqual([
    { path: "/api/setting", method: "GET", options: undefined },
    {
      path: "/api/setting/report-timezone",
      method: "PUT",
      options: {
        method: "PUT",
        body: { value: "Europe/Berlin" },
        expectContentType: "binary",
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "set setting report-timezone",
    value: { key: "report-timezone", value: "Europe/Berlin" },
  });
});

test("null clears a setting back to its default", async () => {
  const { deps } = toolDeps(SETTINGS);

  const result = await runInstanceSettingsTool(deps, {
    action: "set",
    key: "site-name",
    value: null,
  });

  expect(result.details).toEqual({
    kind: "json",
    label: "cleared setting site-name",
    value: { key: "site-name", value: null },
  });
});

test("a setting fed from the environment names the variable instead of failing opaquely", async () => {
  const { deps, requests } = toolDeps(SETTINGS);

  await expect(
    runInstanceSettingsTool(deps, {
      action: "set",
      key: "site-url",
      value: "https://other.example.com",
    }),
  ).rejects.toThrow(
    new TeachingError(
      '"site-url" is set from the environment variable `MB_SITE_URL`, and the API cannot override it. Change the variable on the server and restart Metabase; nothing you send here will take.',
    ),
  );
  expect(requests).toEqual([{ path: "/api/setting", method: "GET", options: undefined }]);
});

test("an unknown key comes back with the near matches named", async () => {
  const { deps } = toolDeps(SETTINGS);

  await expect(runInstanceSettingsTool(deps, { action: "get", key: "site-title" })).rejects.toThrow(
    new TeachingError(
      'This instance has no setting "site-title". Did you mean `site-name`, `site-url`?',
    ),
  );
});
