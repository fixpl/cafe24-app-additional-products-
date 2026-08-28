import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store, no-cache, must-revalidate, private' });
	if (['mall_id', 'shop_no', 'timestamp', 'hmac'].some((key) => url.searchParams.has(key))) {
		throw redirect(307, `/app${url.search}`);
	}
	return {
		invalidAccess: url.searchParams.get('access') === 'invalid'
	};
};
