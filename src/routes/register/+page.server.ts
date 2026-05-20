import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

export const actions: Actions = {
	signUpEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const publicKey = formData.get('publicKey')?.toString() ?? '';
		const name = formData.get('name')?.toString() ?? '';

		try {
			const response = await auth.api.signUpEmail({
				body: {
					email,
					password,
					name,
					publicKey,
					rememberMe: true,
					callbackURL: '/auth/verification-success'
				}
			});

			return {success: true as const, id: response.user.id};
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: error.message || 'Registration failed' });
			}
			console.error('Signup error:', error);
			return fail(500, { message: 'Unexpected error' });
		}
	}
};
