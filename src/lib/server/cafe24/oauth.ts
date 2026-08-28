import { createHash, randomUUID } from 'node:crypto';
import { CAFE24_REQUIRED_SCOPES } from '$lib/shared/types';
import { normalizeMallId, normalizeShopNo } from '$lib/shared/validation';
import {
	getCafe24ClientId,
	getCafe24ClientSecret,
	getCafe24RedirectUri,
	getRequestTimeoutMs
} from '$lib/server/env';
import { PublicError } from '$lib/server/http';
import { signOAuthState, type OAuthStatePayload, type TokenPayload } from './crypto';

const OAUTH_STATE_LIFETIME_MS = 10 * 60_000;
const refreshPromises = new Map<string, Promise<TokenPayload>>();

interface StartOAuthOptions {
	mallId: string;
	shopNo: string;
	userId?: string | null;
	requestUrl: URL;
}

interface TokenResponse {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_at?: unknown;
	refresh_token_expires_at?: unknown;
	client_id?: unknown;
	mall_id?: unknown;
	user_id?: unknown;
	scopes?: unknown;
	scope?: unknown;
	issued_at?: unknown;
	shop_no?: unknown;
}

function optionalIdentity(value: unknown) {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized && normalized.length <= 128 ? normalized : null;
}

export function beginCafe24OAuth(options: StartOAuthOptions) {
	const mallId = normalizeMallId(options.mallId);
	const shopNo = normalizeShopNo(options.shopNo);
	const now = Date.now();
	const statePayload: OAuthStatePayload = {
		v: 1,
		mallId,
		shopNo,
		userId: optionalIdentity(options.userId),
		mode: 'launch',
		nonce: randomUUID(),
		issuedAt: now,
		expiresAt: now + OAUTH_STATE_LIFETIME_MS
	};
	const state = signOAuthState(statePayload);
	const authorizeUrl = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('client_id', getCafe24ClientId());
	authorizeUrl.searchParams.set('state', state);
	authorizeUrl.searchParams.set('mall_id', mallId);
	authorizeUrl.searchParams.set('redirect_uri', getCafe24RedirectUri(options.requestUrl));
	authorizeUrl.searchParams.set('scope', CAFE24_REQUIRED_SCOPES.join(' '));
	authorizeUrl.searchParams.set('shop_no', shopNo);
	return { authorizeUrl: authorizeUrl.toString(), state, statePayload };
}

export async function exchangeCodeForToken(params: {
	code: string;
	state: OAuthStatePayload;
	requestUrl: URL;
	sessionBindingHash: string;
}) {
	if (!params.code || params.code.length > 4096) {
		throw new PublicError(400, 'OAUTH_CODE_INVALID', 'OAuth 인증 코드가 올바르지 않습니다.');
	}
	const response = await requestToken(params.state.mallId, {
		grant_type: 'authorization_code',
		code: params.code,
		redirect_uri: getCafe24RedirectUri(params.requestUrl)
	});
	return normalizeTokenResponse(response, {
		mallId: params.state.mallId,
		shopNo: params.state.shopNo,
		userId: params.state.userId,
		sessionBindingHash: params.sessionBindingHash
	});
}

export function refreshCafe24Token(payload: TokenPayload) {
	if (Date.parse(payload.refreshTokenExpiresAt) <= Date.now()) {
		throw new PublicError(
			401,
			'REFRESH_TOKEN_EXPIRED',
			'Cafe24 로그인 갱신 기간이 끝났습니다. 다시 로그인해주세요.',
			true
		);
	}
	const key = createHash('sha256').update(payload.refreshToken, 'utf8').digest('base64url');
	const running = refreshPromises.get(key);
	if (running) return running;
	const promise = requestToken(payload.mallId, {
		grant_type: 'refresh_token',
		refresh_token: payload.refreshToken
	})
		.then((response) =>
			normalizeTokenResponse(
				{ ...response, refresh_token: response.refresh_token || payload.refreshToken },
				{
					mallId: payload.mallId,
					shopNo: payload.shopNo,
					userId: payload.userId,
					sessionBindingHash: payload.sessionBindingHash,
					previousRefreshTokenExpiresAt: payload.refreshTokenExpiresAt
				}
			)
		)
		.finally(() => refreshPromises.delete(key));
	refreshPromises.set(key, promise);
	return promise;
}

async function requestToken(mallIdInput: string, params: Record<string, string>) {
	const mallId = normalizeMallId(mallIdInput);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs());
	let response: Response;
	try {
		response = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
			method: 'POST',
			headers: {
				authorization: `Basic ${Buffer.from(`${getCafe24ClientId()}:${getCafe24ClientSecret()}`).toString('base64')}`,
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json'
			},
			body: new URLSearchParams(params),
			signal: controller.signal
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new PublicError(504, 'CAFE24_TIMEOUT', 'Cafe24 인증 서버 응답 시간이 초과되었습니다.');
		}
		throw new PublicError(
			502,
			'CAFE24_AUTH_UNAVAILABLE',
			'Cafe24 인증 서버에 연결하지 못했습니다.'
		);
	} finally {
		clearTimeout(timeout);
	}
	const raw = await response.text();
	let body: unknown;
	try {
		body = raw ? JSON.parse(raw) : null;
	} catch {
		body = null;
	}
	if (!response.ok) {
		const code = safeRemoteErrorCode(body);
		throw new PublicError(
			response.status === 400 || response.status === 401 ? 401 : 502,
			'CAFE24_AUTH_REJECTED',
			code ? `Cafe24 인증 요청이 거절되었습니다. (${code})` : 'Cafe24 인증 요청이 거절되었습니다.',
			response.status === 400 || response.status === 401
		);
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new PublicError(502, 'CAFE24_AUTH_INVALID', 'Cafe24 인증 응답 형식이 올바르지 않습니다.');
	}
	return body as TokenResponse;
}

function safeRemoteErrorCode(body: unknown) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const value = (body as Record<string, unknown>).error;
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

function normalizeTokenResponse(
	response: TokenResponse,
	context: {
		mallId: string;
		shopNo: string;
		userId: string | null;
		sessionBindingHash: string;
		previousRefreshTokenExpiresAt?: string;
	}
): TokenPayload {
	const accessToken = requiredString(response.access_token, 'access_token');
	const refreshToken = requiredString(response.refresh_token, 'refresh_token');
	const accessTokenExpiresAt = requiredDate(response.expires_at, 'expires_at');
	const refreshTokenExpiresAt = response.refresh_token_expires_at
		? requiredDate(response.refresh_token_expires_at, 'refresh_token_expires_at')
		: context.previousRefreshTokenExpiresAt
			? requiredDate(context.previousRefreshTokenExpiresAt, 'refresh_token_expires_at')
			: missingTokenField('refresh_token_expires_at');
	const clientId = requiredString(response.client_id, 'client_id');
	const mallId = normalizeMallId(requiredString(response.mall_id, 'mall_id'));
	const shopNo = normalizeShopNo(response.shop_no ?? context.shopNo);
	const userId = optionalIdentity(response.user_id) ?? context.userId;
	const scopes = normalizeScopes(response.scopes ?? response.scope);
	if (clientId !== getCafe24ClientId() || mallId !== context.mallId || shopNo !== context.shopNo) {
		throw new PublicError(
			401,
			'TOKEN_CONTEXT_MISMATCH',
			'Cafe24 로그인 응답의 앱 또는 쇼핑몰 정보가 일치하지 않습니다.',
			true
		);
	}
	const requiredScopes = [...CAFE24_REQUIRED_SCOPES].sort();
	if (
		scopes.length !== requiredScopes.length ||
		scopes.some((scope, index) => scope !== requiredScopes[index])
	) {
		throw new PublicError(
			403,
			'TOKEN_SCOPE_INVALID',
			'Cafe24 로그인 권한이 앱에 설정된 필수 권한과 일치하지 않습니다.',
			true
		);
	}
	return {
		accessToken,
		refreshToken,
		accessTokenExpiresAt,
		refreshTokenExpiresAt,
		clientId,
		mallId,
		shopNo,
		userId,
		scopes,
		issuedAt: response.issued_at
			? requiredDate(response.issued_at, 'issued_at')
			: new Date().toISOString(),
		sessionBindingHash: context.sessionBindingHash
	};
}

function requiredString(value: unknown, field: string) {
	if (typeof value !== 'string' || !value.trim() || value.length > 4096)
		return missingTokenField(field);
	return value;
}

function requiredDate(value: unknown, field: string) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
		return missingTokenField(field);
	return new Date(value).toISOString();
}

function missingTokenField(field: string): never {
	throw new PublicError(
		502,
		'CAFE24_AUTH_INVALID',
		`Cafe24 인증 응답에 유효한 ${field} 값이 없습니다.`
	);
}

function normalizeScopes(value: unknown) {
	const scopes = Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: typeof value === 'string'
			? value.split(/[\s,]+/)
			: [];
	return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}
