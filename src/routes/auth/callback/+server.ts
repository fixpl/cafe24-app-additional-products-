import { redirect, error } from '@sveltejs/kit';
import {
	assertStateCookie,
	createSessionBinding,
	encryptTokenPayload,
	hashSessionBinding,
	verifyOAuthState
} from '$lib/server/cafe24/crypto';
import { exchangeCodeForToken } from '$lib/server/cafe24/oauth';
import {
	OAUTH_STATE_COOKIE,
	SESSION_BINDING_COOKIE,
	TOKEN_CLAIM_COOKIE,
	secureCookie
} from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const providerError = url.searchParams.get('error');
	if (providerError) {
		const errorState = url.searchParams.get('state');
		if (!errorState) {
			throw error(400, 'state가 없습니다.');
		}
		verifyOAuthState(errorState);
		assertStateCookie(errorState, cookies.get(OAUTH_STATE_COOKIE));
		cookies.delete(OAUTH_STATE_COOKIE, {
			path: '/auth/callback',
			secure: secureCookie(url),
			sameSite: 'lax'
		});
		throw redirect(302, '/auth/complete?error=authorization_denied');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		throw error(400, 'code 또는 state가 없습니다.');
	}

	const oauthState = verifyOAuthState(state);
	assertStateCookie(state, cookies.get(OAUTH_STATE_COOKIE));

	const sessionBinding = createSessionBinding();
	const token = await exchangeCodeForToken({
		code,
		state: oauthState,
		requestUrl: url,
		sessionBindingHash: hashSessionBinding(sessionBinding)
	});
	const envelope = encryptTokenPayload(token);
	if (envelope.length > 3_500) {
		throw error(502, '암호화된 로그인 정보를 브라우저에 안전하게 전달할 수 없습니다.');
	}

	cookies.delete(OAUTH_STATE_COOKIE, {
		path: '/auth/callback',
		secure: secureCookie(url),
		sameSite: 'lax'
	});
	cookies.set(SESSION_BINDING_COOKIE, sessionBinding, {
		path: '/',
		httpOnly: true,
		secure: secureCookie(url),
		sameSite: 'strict',
		maxAge: sessionCookieMaxAge(token.refreshTokenExpiresAt)
	});
	cookies.set(TOKEN_CLAIM_COOKIE, envelope, {
		path: '/api/auth/claim',
		httpOnly: true,
		secure: secureCookie(url),
		sameSite: 'strict',
		maxAge: 10 * 60
	});

	throw redirect(302, '/auth/complete');
};

function sessionCookieMaxAge(refreshTokenExpiresAt: string) {
	const seconds = Math.floor((Date.parse(refreshTokenExpiresAt) - Date.now()) / 1000);
	return Math.max(60, Math.min(seconds, 14 * 24 * 60 * 60));
}
