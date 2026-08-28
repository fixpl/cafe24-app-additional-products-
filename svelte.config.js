import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';

const isRailpackBuild = process.env.SVELTE_ADAPTER === 'node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: isRailpackBuild
			? adapterNode({
					out: 'build',
					precompress: true
				})
			: adapterVercel()
	}
};

export default config;
