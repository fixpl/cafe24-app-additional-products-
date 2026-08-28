import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

export const CAFE24_API_VERSION_DEFAULT = '2026-06-01';
export const OAUTH_STATE_COOKIE = 'cafe24_ap_oauth_state';
export const TOKEN_CLAIM_COOKIE = 'cafe24_ap_token_claim';
export const SESSION_BINDING_COOKIE = 'cafe24_ap_session';

function required(name: string) {
	const value = env[name]?.trim();
	if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
	return value;
}

export function getCafe24ClientId() {
	return required('CAFE24_CLIENT_ID');
}

export function getCafe24ClientSecret() {
	return required('CAFE24_CLIENT_SECRET');
}

export function getOauthStateSecret() {
	return env.CAFE24_OAUTH_STATE_SECRET?.trim() || getCafe24ClientSecret();
}

export function getCafe24ApiVersion() {
	const version = env.CAFE24_API_VERSION?.trim() || CAFE24_API_VERSION_DEFAULT;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
		throw new Error('CAFE24_API_VERSION은 YYYY-MM-DD 형식이어야 합니다.');
	}
	return version;
}

export function getCafe24RedirectUri(requestUrl: URL) {
	const configured = env.CAFE24_REDIRECT_URI?.trim();
	const url = configured ? new URL(configured) : new URL('/auth/callback', requestUrl.origin);
	if (url.pathname !== '/auth/callback' || url.search || url.hash) {
		throw new Error('CAFE24_REDIRECT_URI는 /auth/callback 경로여야 합니다.');
	}
	if (!dev && url.protocol !== 'https:') {
		throw new Error('운영 CAFE24_REDIRECT_URI는 HTTPS여야 합니다.');
	}
	if (!configured && !dev) {
		throw new Error('운영 환경에는 CAFE24_REDIRECT_URI를 명시해야 합니다.');
	}
	return url.toString();
}

export function getRequestTimeoutMs() {
	const value = Number(env.CAFE24_REQUEST_TIMEOUT_MS ?? '15000');
	return Number.isInteger(value) && value >= 1000 && value <= 30000 ? value : 15000;
}

export function canSkipLaunchHmac() {
	return dev && env.CAFE24_SKIP_HMAC_CHECK === 'true';
}

export interface EncryptionKeyEntry {
	kid: string;
	key: Buffer;
}

export function getTokenEncryptionKeys(): EncryptionKeyEntry[] {
	const configured = env.CAFE24_TOKEN_ENCRYPTION_KEYS?.trim();
	const legacy = env.CAFE24_TOKEN_ENCRYPTION_KEY?.trim();
	const entries = configured
		? configured.split(',').map((entry) => entry.trim())
		: legacy
			? [`${env.CAFE24_TOKEN_ENCRYPTION_KEY_ID?.trim() || 'v1'}:${legacy}`]
			: [];
	if (entries.length === 0) {
		throw new Error('CAFE24_TOKEN_ENCRYPTION_KEYS 환경변수가 필요합니다.');
	}
	const seen = new Set<string>();
	return entries.map((entry) => {
		const separator = entry.indexOf(':');
		if (separator <= 0) throw new Error('암호화 키는 kid:base64 형식이어야 합니다.');
		const kid = entry.slice(0, separator);
		const encoded = entry.slice(separator + 1);
		if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid) || seen.has(kid)) {
			throw new Error('암호화 key id가 올바르지 않거나 중복되었습니다.');
		}
		seen.add(kid);
		if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
			throw new Error(`${kid} 암호화 키는 32-byte base64url이어야 합니다.`);
		}
		const key = Buffer.from(encoded, 'base64url');
		if (key.length !== 32) throw new Error(`${kid} 암호화 키는 정확히 32 bytes여야 합니다.`);
		return { kid, key };
	});
}

export function secureCookie(requestUrl: URL) {
	return requestUrl.protocol === 'https:';
}
