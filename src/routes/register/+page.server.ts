import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

export const actions: Actions = {
	signUpEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const username = formData.get('username')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const publicKey = formData.get('publicKey')?.toString() ?? '';
		const privateKey = formData.get('privateKey')?.toString() ?? '';
		const salt = formData.get('salt')?.toString() ?? '';
		const nonce = formData.get('nonce')?.toString() ?? '';
		const name = formData.get('name')?.toString() ?? '';

		try {
			const response = await auth.api.signUpEmail({
				body: {
					email,
					username,
					password,
					name,
					publicKey,
					privateKey,
					salt,
					nonce,
					rememberMe: true,
					callbackURL: '/auth/verification-success'
				}
			});

			return { success: true as const, id: response.user.id };
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: error.message || 'Registration failed' });
			}
			console.error('Signup error:', error);
			return fail(500, { message: 'Unexpected error' });
		}
	}
};
