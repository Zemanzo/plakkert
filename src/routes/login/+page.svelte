<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { ActionData } from './$types';
	import { db } from '$lib/client/Database';
	import { decryptPrivateKey } from '$lib/client/cryptography/PrivateKey';

	let { form }: { form: ActionData } = $props();
</script>

<h1>Login</h1>
<form
	method="post"
	action="?/signInEmail"
	use:enhance={() => {
		return async ({ result, formData }) => {
			if (result.type === 'redirect') {
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
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(result.location);
			} else {
				await applyAction(result);
			}
		};
	}}
>
	<label>
		Email
		<input type="email" name="email" />
	</label>
	<label>
		Password
		<input type="password" name="password" />
	</label>
	<button>Login</button>
</form>
<p style="color: red">{form?.message ?? ''}</p>
