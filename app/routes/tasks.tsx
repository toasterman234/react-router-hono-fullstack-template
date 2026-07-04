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

export function meta() {
	return [{ title: "Agent Tasks" }];
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL("/api/tasks", request.url);
	const res = await fetch(url.toString());
	if (!res.ok) {
		return { tasks: [] as Task[], error: `tasks fetch failed: ${res.status}` };
	}
	const data = (await res.json()) as { tasks: Task[] };
	return { tasks: data.tasks ?? [], error: null as string | null };
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
	const { tasks, error } = loaderData;

	return (
		<div className="max-w-3xl mx-auto p-6">
			<Nav />
			<h1 className="text-xl font-semibold mb-1">Agent Tasks</h1>
			<p className="text-sm text-gray-500 mb-6">
				Open GitHub issues, treated as a task queue.
			</p>

			{error && (
				<p className="text-sm text-red-600 mb-4">Couldn't load tasks: {error}</p>
			)}

			{tasks.length === 0 && !error ? (
				<div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-500">
					No open issues in the configured repos.
				</div>
			) : (
				<ul className="divide-y divide-gray-200 dark:divide-gray-800">
					{tasks.map((t) => (
						<li key={`${t.repo}#${t.number}`} className="py-4">
							<div className="flex items-center justify-between text-xs text-gray-500 mb-1">
								<span>{t.repo}</span>
								<span>updated {new Date(t.updated_at).toLocaleDateString()}</span>
							</div>
							<a
								href={t.url}
								target="_blank"
								rel="noreferrer"
								className="font-medium hover:underline"
							>
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
		</div>
	);
}
