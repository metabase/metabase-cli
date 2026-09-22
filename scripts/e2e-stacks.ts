export interface Stack {
  id: string;
  image: string;
  port: number;
}

export const STACKS: readonly Stack[] = [
  { id: "oss-58", image: "metabase/metabase:v0.58.34", port: 13058 },
  { id: "ee-58", image: "metabase/metabase-enterprise:v1.58.34", port: 13158 },
  { id: "oss-59", image: "metabase/metabase:v0.59.31", port: 13059 },
  { id: "ee-59", image: "metabase/metabase-enterprise:v1.59.31", port: 13159 },
  { id: "oss-60", image: "metabase/metabase:v0.60.27", port: 13060 },
  { id: "ee-60", image: "metabase/metabase-enterprise:v1.60.27", port: 13160 },
  { id: "oss-61", image: "metabase/metabase:v0.61.21", port: 13061 },
  { id: "ee-61", image: "metabase/metabase-enterprise:v1.61.21", port: 13161 },
  { id: "oss-62", image: "metabase/metabase:v0.62.19.5", port: 13062 },
  { id: "ee-62", image: "metabase/metabase-enterprise:v1.62.19.5", port: 13162 },
  { id: "oss-63", image: "metabase/metabase:v0.63.18", port: 13063 },
  { id: "ee-63", image: "metabase/metabase-enterprise:v1.63.18", port: 13163 },
  { id: "oss-64", image: "metabase/metabase:v0.64.0.1-beta", port: 13064 },
  { id: "ee-64", image: "metabase/metabase-enterprise:v1.64.0.1-beta", port: 13164 },
  { id: "oss-head", image: "metabase/metabase-head:latest", port: 13065 },
  { id: "ee-head", image: "metabase/metabase-enterprise-head:latest", port: 13165 },
];
