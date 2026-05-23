<script lang="ts">
	import { Tipex } from '@friendofsvelte/tipex';

	let body = `<h1>Title...</h1>
	<p>Serialize your thoughts...</p>`;
</script>

<Tipex {body} class="h-full w-full" controlComponent={null} />
