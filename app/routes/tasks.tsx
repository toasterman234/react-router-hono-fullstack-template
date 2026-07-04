import { Form, useNavigation } from "react-router";
import { Nav } from "../components/nav";
import type { Route } from "./+types/tasks";

type Task = {
	repo: string;
	number: number;
	title: string;
	url: string;
	state: string;
	labels: string[];
	created_at: string;
	updated_at: string;
};

type UnifiedMessage = {
	id: number;
	subject: string;
	excerpt: string;
	importance: string;
	sender: string;
	recipients: string;
	project_slug: string;
	project_name: string;
	created_relative: string;
	read: boolean;
};

type MailAgent = {
	name: string;
	program: string;
	model: string;
	task_description: string;
};

type ProjectAgents = { project: string; agents: MailAgent[]; error: string | null };

type SearchResult = {
	id: number;
	subject: string;
	importance: string;
	created_ts: string;
	from: string;
};

export function meta() {
	return [{ title: "Agent Dashboard" }];
}

export async function loader({ request }: Route.LoaderArgs) {
	const requestUrl = new URL(request.url);

	const tasksRes = await fetch(new URL("/api/tasks", request.url).toString());
	const tasksData = tasksRes.ok
		? ((await tasksRes.json()) as { tasks: Task[] })
		: { tasks: [] as Task[] };

	const inboxRes = await fetch(new URL("/api/inbox", request.url).toString());
	const inboxData = inboxRes.ok
		? ((await inboxRes.json()) as { messages: UnifiedMessage[] })
		: { messages: [] as UnifiedMessage[] };

	const projectsRes = await fetch(new URL("/api/mail-projects", request.url).toString());
	const projectsData = projectsRes.ok
		? ((await projectsRes.json()) as { projects: string[] })
		: { projects: [] as string[] };

	const projectAgents: ProjectAgents[] = await Promise.all(
		projectsData.projects.map(async (project) => {
			const res = await fetch(
				new URL(`/api/projects/${encodeURIComponent(project)}/agents`, request.url).toString(),
			);
			if (!res.ok) {
				return { project, agents: [], error: `fetch failed: ${res.status}` };
			}
			const data = (await res.json()) as { agents?: MailAgent[] };
			return { project, agents: data.agents ?? [], error: null };
		}),
	);

	const searchProject = requestUrl.searchParams.get("search_project");
	const searchQuery = requestUrl.searchParams.get("search_query");
	let searchResults: SearchResult[] = [];
	let searchError: string | null = null;
	if (searchProject && searchQuery) {
		const searchRes = await fetch(
			new URL(
				`/api/search?project=${encodeURIComponent(searchProject)}&query=${encodeURIComponent(searchQuery)}`,
				request.url,
			).toString(),
		);
		const data = (await searchRes.json()) as { result?: SearchResult[]; error?: string };
		searchResults = data.result ?? [];
		searchError = data.error ?? null;
	}

	return {
		tasks: tasksData.tasks ?? [],
		messages: inboxData.messages ?? [],
		projects: projectsData.projects,
		projectAgents,
		searchProject: searchProject ?? "",
		searchQuery: searchQuery ?? "",
		searchResults,
		searchError,
	};
}

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData();
	const project = String(form.get("project") ?? "");
	const sender = String(form.get("sender") ?? "");
	const to = String(form.get("to") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const subject = String(form.get("subject") ?? "");
	const body_md = String(form.get("body_md") ?? "");

	const res = await fetch(new URL("/api/compose", request.url).toString(), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ project, sender, to, subject, body_md }),
	});
	const data = (await res.json()) as { ok?: boolean; error?: string };
	return { composeOk: Boolean(data.ok), composeError: data.error ?? null };
}

const importanceClass: Record<string, string> = {
	urgent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	high: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	normal: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
	low: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export default function Tasks({ loaderData, actionData }: Route.ComponentProps) {
	const {
		tasks,
		messages,
		projects,
		projectAgents,
		searchProject,
		searchQuery,
		searchResults,
		searchError,
	} = loaderData;
	const navigation = useNavigation();
	const composing = navigation.state === "submitting";

	return (
		<div className="max-w-3xl mx-auto p-6 space-y-10">
			<Nav />

			<section>
				<h1 className="text-xl font-semibold mb-1">Open Issues</h1>
				<p className="text-sm text-gray-500 mb-4">
					GitHub issues from the configured repos, treated as a task queue.
				</p>
				{tasks.length === 0 ? (
					<div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-gray-500 text-sm">
						No open issues in the configured repos.
					</div>
				) : (
					<ul className="divide-y divide-gray-200 dark:divide-gray-800">
						{tasks.map((t) => (
							<li key={`${t.repo}#${t.number}`} className="py-3">
								<div className="flex items-center justify-between text-xs text-gray-500 mb-1">
									<span>{t.repo}</span>
									<span>updated {new Date(t.updated_at).toLocaleDateString()}</span>
								</div>
								<a href={t.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
									#{t.number} {t.title}
								</a>
								{t.labels.length > 0 && (
									<div className="flex gap-1.5 mt-1.5 flex-wrap">
										{t.labels.map((l) => (
											<span
												key={l}
												className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
											>
												{l}
											</span>
										))}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="text-lg font-semibold mb-1">Mail Inbox</h2>
				<p className="text-sm text-gray-500 mb-4">Unified inbox across all mcp-agent-mail projects.</p>
				{messages.length === 0 ? (
					<div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-gray-500 text-sm">
						No messages yet.
					</div>
				) : (
					<ul className="divide-y divide-gray-200 dark:divide-gray-800">
						{messages.slice(0, 20).map((m) => (
							<li key={m.id} className="py-3">
								<div className="flex items-center justify-between text-xs text-gray-500 mb-1">
									<span>
										{m.project_name} &middot; {m.sender} &rarr; {m.recipients}
									</span>
									<span>{m.created_relative}</span>
								</div>
								<div className="flex items-center gap-2">
									<span
										className={`text-xs px-1.5 py-0.5 rounded ${importanceClass[m.importance] ?? importanceClass.normal}`}
									>
										{m.importance}
									</span>
									<span className={`font-medium ${m.read ? "text-gray-600 dark:text-gray-400" : ""}`}>
										{m.subject}
									</span>
								</div>
								<p className="text-sm text-gray-500 mt-1">{m.excerpt}</p>
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="text-lg font-semibold mb-1">Agent Directory</h2>
				<p className="text-sm text-gray-500 mb-4">Registered agents by project.</p>
				<div className="space-y-4">
					{projectAgents.map((pa) => (
						<div key={pa.project} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
							<p className="text-xs font-mono text-gray-500 mb-2 break-all">{pa.project}</p>
							{pa.error ? (
								<p className="text-xs text-red-600">{pa.error}</p>
							) : pa.agents.length === 0 ? (
								<p className="text-xs text-gray-400">No agents registered.</p>
							) : (
								<ul className="text-sm space-y-1">
									{pa.agents.map((a) => (
										<li key={a.name}>
											<span className="font-medium">{a.name}</span>{" "}
											<span className="text-gray-500">
												({a.program} / {a.model}) — {a.task_description}
											</span>
										</li>
									))}
								</ul>
							)}
						</div>
					))}
				</div>
			</section>

			<section>
				<h2 className="text-lg font-semibold mb-1">Search</h2>
				<Form method="get" className="flex gap-2 mb-4">
					<select
						name="search_project"
						defaultValue={searchProject}
						className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					>
						<option value="">Select project…</option>
						{projects.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
					<input
						type="text"
						name="search_query"
						defaultValue={searchQuery}
						placeholder="Search subject/body…"
						className="flex-1 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					/>
					<button
						type="submit"
						className="px-3 py-1 text-sm rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
					>
						Search
					</button>
				</Form>
				{searchError && <p className="text-sm text-red-600 mb-2">{searchError}</p>}
				{searchQuery && searchResults.length === 0 && !searchError && (
					<p className="text-sm text-gray-500">No results for "{searchQuery}".</p>
				)}
				{searchResults.length > 0 && (
					<ul className="divide-y divide-gray-200 dark:divide-gray-800">
						{searchResults.map((r) => (
							<li key={r.id} className="py-2 text-sm">
								<span className="text-gray-500">{r.from}</span> — {r.subject}
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2 className="text-lg font-semibold mb-1">Compose</h2>
				<Form method="post" className="space-y-2">
					<select
						name="project"
						required
						className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					>
						<option value="">Select project…</option>
						{projects.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
					<input
						type="text"
						name="sender"
						required
						placeholder="Sender agent name (e.g. ProudCardinal)"
						className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					/>
					<input
						type="text"
						name="to"
						required
						placeholder="Recipient agent name(s), comma-separated"
						className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					/>
					<input
						type="text"
						name="subject"
						required
						placeholder="Subject"
						className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					/>
					<textarea
						name="body_md"
						required
						rows={4}
						placeholder="Message body (Markdown)"
						className="w-full border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm bg-transparent"
					/>
					<button
						type="submit"
						disabled={composing}
						className="px-3 py-1 text-sm rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50"
					>
						{composing ? "Sending…" : "Send"}
					</button>
				</Form>
				{actionData?.composeError && (
					<p className="text-sm text-red-600 mt-2">{actionData.composeError}</p>
				)}
				{actionData?.composeOk && (
					<p className="text-sm text-green-600 mt-2">Sent.</p>
				)}
			</section>
		</div>
	);
}
