import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store, no-cache, must-revalidate, private' });
	return {
		invalidAccess: url.searchParams.get('access') === 'invalid'
	};
};
