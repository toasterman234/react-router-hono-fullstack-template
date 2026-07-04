import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import {
	fetchGithubTasks,
	fetchInbox,
	fetchProjectAgents,
	listMailProjects,
	searchMessages,
	sendMessage,
} from "../app/lib/agent-mail.server";

const app = new Hono<{ Bindings: Env }>();

// These /api/* routes exist for external consumers / debugging via curl.
// The app's own pages (app/routes/*.tsx) call the same helpers directly via
// context.cloudflare.env instead of fetching these routes — a same-worker
// subrequest to this Worker's own workers.dev URL does not loop back through
// Hono's router and 404s.
app.get("/api/inbox", async (c) => c.json(await fetchInbox(c.env)));

app.get("/api/projects/:project/agents", async (c) =>
	c.json(await fetchProjectAgents(c.env, c.req.param("project"))),
);

app.get("/api/mail-projects", (c) => c.json({ projects: listMailProjects(c.env) }));

app.get("/api/search", async (c) => {
	const project = c.req.query("project");
	const query = c.req.query("query");
	if (!project || !query) {
		return c.json({ result: [], error: "project and query are required" }, 400);
	}
	return c.json(await searchMessages(c.env, project, query));
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
		return c.json({ ok: false, error: "project, sender, to, subject, and body_md are required" }, 400);
	}

	return c.json(await sendMessage(c.env, body));
});

app.get("/api/tasks", async (c) => c.json({ tasks: await fetchGithubTasks(c.env) }));

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
