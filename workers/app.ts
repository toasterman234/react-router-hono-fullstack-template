import { Hono } from "hono";
import { createRequestHandler } from "react-router";

type Env = {
	AGENT_MAIL_URL: string;
	AGENT_MAIL_TOKEN: string;
	CF_ACCESS_CLIENT_ID: string;
	CF_ACCESS_CLIENT_SECRET: string;
	AGENT_MAIL_PROJECTS: string;
	GITHUB_TOKEN: string;
	GITHUB_REPOS: string;
};

const app = new Hono<{ Bindings: Env }>();

// mcp-agent-mail's REST surface only covers 3 read endpoints (unified-inbox,
// projects/{project}/agents, sibling-suggestion). Search and send only exist
// via its MCP JSON-RPC interface at /mcp/ — same auth as the REST calls
// (CF Access service-token headers + the app's own bearer token).
async function callAgentMailTool(env: Env, name: string, args: Record<string, unknown>) {
	const res = await fetch(`${env.AGENT_MAIL_URL}/mcp/`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
			"CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
			Authorization: `Bearer ${env.AGENT_MAIL_TOKEN}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});

	if (!res.ok) {
		throw new Error(`mcp-agent-mail ${name} call failed: ${res.status}`);
	}

	const payload = (await res.json()) as {
		error?: { message: string };
		result?: { content?: Array<{ type: string; text?: string }> };
	};

	if (payload.error) {
		throw new Error(payload.error.message);
	}

	const text = payload.result?.content?.[0]?.text;
	if (!text) return payload.result ?? null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

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

app.get("/api/mail-projects", (c) => {
	const projects = c.env.AGENT_MAIL_PROJECTS.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	return c.json({ projects });
});

app.get("/api/search", async (c) => {
	const project = c.req.query("project");
	const query = c.req.query("query");
	if (!project || !query) {
		return c.json({ result: [], error: "project and query are required" }, 400);
	}
	try {
		const result = await callAgentMailTool(c.env, "search_messages", {
			project_key: project,
			query,
			limit: 20,
			ranking: "recency",
		});
		return c.json(result);
	} catch (err) {
		return c.json({ result: [], error: (err as Error).message }, 502);
	}
});

app.post("/api/compose", async (c) => {
	const body = await c.req.json<{
		project: string;
		sender: string;
		to: string[];
		subject: string;
		body_md: string;
	}>();

	if (!body.project || !body.sender || !body.to?.length || !body.subject || !body.body_md) {
		return c.json({ error: "project, sender, to, subject, and body_md are required" }, 400);
	}

	try {
		const result = await callAgentMailTool(c.env, "send_message", {
			project_key: body.project,
			sender_name: body.sender,
			to: body.to,
			subject: body.subject,
			body_md: body.body_md,
		});
		return c.json({ ok: true, result });
	} catch (err) {
		return c.json({ ok: false, error: (err as Error).message }, 502);
	}
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
