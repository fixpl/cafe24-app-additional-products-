import {
	OAUTH_STATE_COOKIE,
	SESSION_BINDING_COOKIE,
	TOKEN_CLAIM_COOKIE,
	secureCookie
} from '$lib/server/env';
import { assertSameOrigin, errorResponse, jsonNoStore } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		cookies.delete(OAUTH_STATE_COOKIE, {
			secure: secureCookie(url),
			sameSite: 'lax',
			path: '/auth/callback'
		});
		cookies.delete(TOKEN_CLAIM_COOKIE, {
			secure: secureCookie(url),
			sameSite: 'strict',
			path: '/api/auth/claim'
		});
		cookies.delete(SESSION_BINDING_COOKIE, {
			secure: secureCookie(url),
			sameSite: 'strict',
			path: '/'
		});
		return jsonNoStore({ ok: true });
	} catch (error) {
		return errorResponse(error);
	}
};
