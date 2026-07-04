import { Hono } from "hono";
import { createRequestHandler } from "react-router";

type Env = {
	AGENT_MAIL_URL: string;
	AGENT_MAIL_TOKEN: string;
	GITHUB_TOKEN: string;
	GITHUB_REPOS: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/inbox", async (c) => {
	const res = await fetch(`${c.env.AGENT_MAIL_URL}/mail/api/unified-inbox`, {
		headers: { Authorization: `Bearer ${c.env.AGENT_MAIL_TOKEN}` },
	});
	const body = await res.text();
	return c.newResponse(body, res.status as any, {
		"content-type": "application/json",
	});
});

app.get("/api/projects/:project/agents", async (c) => {
	const project = c.req.param("project");
	const res = await fetch(
		`${c.env.AGENT_MAIL_URL}/mail/api/projects/${project}/agents`,
		{ headers: { Authorization: `Bearer ${c.env.AGENT_MAIL_TOKEN}` } },
	);
	const body = await res.text();
	return c.newResponse(body, res.status as any, {
		"content-type": "application/json",
	});
});

app.get("/api/tasks", async (c) => {
	const repos = c.env.GITHUB_REPOS.split(",")
		.map((r) => r.trim())
		.filter(Boolean);

	const results = await Promise.all(
		repos.map(async (repo) => {
			const res = await fetch(
				`https://api.github.com/repos/${repo}/issues?state=open&per_page=50`,
				{
					headers: {
						Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
						"User-Agent": "agent-mail-inbox-app",
						Accept: "application/vnd.github+json",
					},
				},
			);
			if (!res.ok) return [];
			const issues = (await res.json()) as any[];
			return issues
				.filter((i) => !i.pull_request)
				.map((i) => ({
					repo,
					number: i.number,
					title: i.title,
					url: i.html_url,
					state: i.state,
					labels: (i.labels || []).map((l: any) =>
						typeof l === "string" ? l : l.name,
					),
					created_at: i.created_at,
					updated_at: i.updated_at,
				}));
		}),
	);

	return c.json({ tasks: results.flat() });
});

// Add more routes here

app.get("*", (c) => {
	const requestHandler = createRequestHandler(
		() => import("virtual:react-router/server-build"),
		import.meta.env.MODE,
	);

	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx },
	});
});

export default app;
