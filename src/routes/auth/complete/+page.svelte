<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { saveTokenCredential } from '$lib/client/indexed-db';
	import type { TokenEnvelopeRecord } from '$lib/shared/types';

	let message = 'Cafe24 연결 정보를 안전하게 저장하고 있습니다.';
	let failed = false;

	onMount(async () => {
		if (new URLSearchParams(location.search).has('error')) {
			failed = true;
			message = 'Cafe24 로그인이 취소되었거나 승인되지 않았습니다. 앱에서 다시 연결해주세요.';
			return;
		}

		try {
			const response = await fetch('/api/auth/claim', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { accept: 'application/json' }
			});
			const body = (await response.json()) as
				TokenEnvelopeRecord | { error?: { message?: string } };
			if (!response.ok || !('envelope' in body)) {
				throw new Error('error' in body ? body.error?.message : undefined);
			}
			await saveTokenCredential(body);
			location.replace('/');
		} catch (error) {
			failed = true;
			message =
				error instanceof Error && error.message
					? error.message
					: '로그인 정보를 브라우저에 저장하지 못했습니다. 앱에서 다시 연결해주세요.';
		}
	});
</script>

<svelte:head>
	<title>Cafe24 연결 처리</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main aria-live="polite">
	<section class:failed>
		<span class="indicator" aria-hidden="true"></span>
		<h1>{failed ? '연결을 완료하지 못했습니다' : 'Cafe24 연결 중'}</h1>
		<p>{message}</p>
		{#if failed}
			<a href={resolve('/')}>앱으로 돌아가기</a>
		{/if}
	</section>
</main>

<style>
	main {
		display: grid;
		min-height: 100vh;
		place-items: center;
		padding: 24px;
		background: #f5f7fb;
		font-family: Pretendard, 'Apple SD Gothic Neo', sans-serif;
		color: #202632;
	}

	section {
		width: min(440px, 100%);
		padding: 40px 32px;
		border: 1px solid #e3e7ef;
		border-radius: 16px;
		background: #fff;
		text-align: center;
		box-shadow: 0 12px 36px rgb(32 38 50 / 8%);
	}

	.indicator {
		display: inline-block;
		width: 32px;
		height: 32px;
		border: 3px solid #dbe5ff;
		border-top-color: #356df3;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.failed .indicator {
		border-color: #f09a9a;
		animation: none;
	}

	h1 {
		margin: 20px 0 8px;
		font-size: 22px;
	}

	p {
		margin: 0;
		color: #667085;
		line-height: 1.65;
	}

	a {
		display: inline-flex;
		margin-top: 24px;
		padding: 10px 18px;
		border-radius: 8px;
		background: #356df3;
		color: #fff;
		text-decoration: none;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.indicator {
			animation: none;
		}
	}
</style>
