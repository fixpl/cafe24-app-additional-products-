import { jsonNoStore } from '$lib/server/http';

export const GET = () =>
	jsonNoStore({
		ok: true,
		service: 'cafe24-additional-products-app'
	});
