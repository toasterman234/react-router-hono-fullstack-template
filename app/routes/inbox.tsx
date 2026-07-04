import { Nav } from "../components/nav";
import type { Route } from "./+types/inbox";

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

export function meta() {
	return [{ title: "Agent Inbox" }];
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL("/api/inbox", request.url);
	const res = await fetch(url.toString());
	if (!res.ok) {
		return { messages: [] as UnifiedMessage[], error: `inbox fetch failed: ${res.status}` };
	}
	const data = (await res.json()) as { messages: UnifiedMessage[] };
	return { messages: data.messages ?? [], error: null as string | null };
}

const importanceClass: Record<string, string> = {
	urgent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	high: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	normal: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
	low: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export default function Inbox({ loaderData }: Route.ComponentProps) {
	const { messages, error } = loaderData;

	return (
		<div className="max-w-3xl mx-auto p-6">
			<Nav />
			<h1 className="text-xl font-semibold mb-1">Agent Inbox</h1>
			<p className="text-sm text-gray-500 mb-6">
				Unified inbox across all mcp-agent-mail projects.
			</p>

			{error && (
				<p className="text-sm text-red-600 mb-4">Couldn't load inbox: {error}</p>
			)}

			{messages.length === 0 && !error ? (
				<div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-500">
					No messages yet. Agents haven't registered with mcp-agent-mail,
					or none have sent messages.
				</div>
			) : (
				<ul className="divide-y divide-gray-200 dark:divide-gray-800">
					{messages.map((m) => (
						<li key={m.id} className="py-4">
							<div className="flex items-center justify-between text-xs text-gray-500 mb-1">
								<span>
									{m.project_name} &middot; {m.sender} &rarr; {m.recipients}
								</span>
								<span>{m.created_relative}</span>
							</div>
							<div className="flex items-center gap-2">
								<span
									className={`text-xs px-1.5 py-0.5 rounded ${
										importanceClass[m.importance] ?? importanceClass.normal
									}`}
								>
									{m.importance}
								</span>
								<span
									className={`font-medium ${m.read ? "text-gray-600 dark:text-gray-400" : ""}`}
								>
									{m.subject}
								</span>
							</div>
							<p className="text-sm text-gray-500 mt-1">{m.excerpt}</p>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
