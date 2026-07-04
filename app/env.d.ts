// wrangler only generates types for `vars` (wrangler.jsonc), not secrets —
// merge the secret-only bindings into the global Env interface here.
export {};

declare global {
	interface Env {
		AGENT_MAIL_TOKEN: string;
		CF_ACCESS_CLIENT_ID: string;
		CF_ACCESS_CLIENT_SECRET: string;
		GITHUB_TOKEN: string;
	}
}
