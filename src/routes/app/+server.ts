import { redirect } from '@sveltejs/kit';
import { stateCookieValue } from '$lib/server/cafe24/crypto';
import { readAndValidateLaunch } from '$lib/server/cafe24/launch';
import { beginCafe24OAuth } from '$lib/server/cafe24/oauth';
import { OAUTH_STATE_COOKIE, secureCookie } from '$lib/server/env';
import { PublicError, errorResponse } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store, no-cache, must-revalidate, private' });
	let authorizeUrl: string;
	try {
		const launch = readAndValidateLaunch(url);
		const oauth = beginCafe24OAuth({
			mallId: launch.mallId,
			shopNo: launch.shopNo,
			userId: launch.userId,
			requestUrl: url
		});
		cookies.set(OAUTH_STATE_COOKIE, stateCookieValue(oauth.state), {
			httpOnly: true,
			secure: secureCookie(url),
			sameSite: 'lax',
			path: '/auth/callback',
			maxAge: 10 * 60
		});
		authorizeUrl = oauth.authorizeUrl;
	} catch (error) {
		if (error instanceof PublicError) {
			throw redirect(302, '/?access=invalid');
		}
		return errorResponse(error);
	}
	throw redirect(302, authorizeUrl);
};
