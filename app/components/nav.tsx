import { NavLink } from "react-router";

export function Nav() {
	const linkClass = ({ isActive }: { isActive: boolean }) =>
		isActive
			? "font-semibold text-gray-900 dark:text-gray-100"
			: "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100";

	return (
		<nav className="flex gap-4 mb-6 text-sm border-b border-gray-200 dark:border-gray-800 pb-4">
			<NavLink to="/" end className={linkClass}>
				Inbox
			</NavLink>
			<NavLink to="/tasks" className={linkClass}>
				Tasks
			</NavLink>
		</nav>
	);
}
