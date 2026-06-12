<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ActionData } from './$types';
	import { db } from '$lib/client/Database';
	import { decryptPrivateKey } from '$lib/client/cryptography/PrivateKey';
	import Button from '$lib/client/components/Button.svelte';

	let { form }: { form: ActionData } = $props();
	let loading = $state(false);
	let success = $state(false);
</script>

<form
	method="post"
	action="?/signInEmail"
	use:enhance={() => {
		loading = true;
		return async ({ result, formData }) => {
			loading = false;
			if (result.type === 'redirect') {
				success = true;
				const email = formData.get('email') as string;
				const password = formData.get('password') as string;
				const user = await db.users.where('email').equals(email).first();
				if (user) {
					const decryptedKeyBuffer = await decryptPrivateKey(
						user.privateKey,
						password,
						user.salt,
						user.nonce
					);
					sessionStorage.setItem(
						'privateKey',
						btoa(String.fromCharCode(...new Uint8Array(decryptedKeyBuffer)))
					);
				}
				await invalidateAll();
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(result.location);
			} else {
				console.log(result);
				await applyAction(result);
			}
		};
	}}
>
	<label for="email"> Email </label>
	<input id="email" type="email" name="email" autocomplete="username" disabled={loading} />
	<label for="password"> Password </label>
	<input
		id="password"
		type="password"
		name="password"
		autocomplete="current-password"
		disabled={loading}
	/>
	<Button type="submit" disabled={loading} class="submitButton">Login</Button>
</form>
{#if !loading && !success && form?.message}
	<p>{form.message}</p>
{/if}

<style>
	form {
		margin: 2em auto;
		display: grid;
		grid-template-columns: min-content 1fr;
		grid-auto-rows: min-content;

		gap: 0.5em;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-display);
		font-size: 1.3rem;

		:global(.submitButton) {
			grid-column: 1 / -1;
			width: 50%;
			justify-self: center;
		}
	}

	label {
		text-align: right;
	}

	p {
		font-family: var(--font-family-display);
		font-size: 1.3rem;
		color: var(--color-red);
		text-align: center;
	}
</style>
