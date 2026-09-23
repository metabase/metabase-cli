import packageJson from "../../package.json" with { type: "json" };

// The CLI's wire identity. The client takes a userAgent from whoever calls it rather than inventing
// one, so the manifest that names this caller is read here and nowhere else.
export const USER_AGENT = `metabase-cli/${packageJson.version}`;
