<svelte:head>
	<meta name="theme-color" content="#f3f4f7" />
</svelte:head>

<slot />

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		background: #f3f4f7;
		color: #1f2937;
		font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font: inherit;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
	}
</style>
