import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	// Pass the user and session from locals straight to the frontend
	return {
		user: locals.user,
		session: locals.session
	};
};
