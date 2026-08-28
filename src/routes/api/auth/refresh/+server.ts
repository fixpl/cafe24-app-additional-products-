import {
	assertSessionBinding,
	decryptTokenEnvelope,
	encryptTokenPayload,
	toTokenEnvelopeRecord,
	type TokenPayload
} from '$lib/server/cafe24/crypto';
import { refreshCafe24Token } from '$lib/server/cafe24/oauth';
import { SESSION_BINDING_COOKIE, secureCookie } from '$lib/server/env';
import {
	PublicError,
	assertSameOrigin,
	errorResponse,
	jsonNoStore,
	readJsonBody
} from '$lib/server/http';
import type { AuthStatus } from '$lib/shared/types';
import type { RequestHandler } from './$types';

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;

interface RefreshRequest {
	envelope?: unknown;
}

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		const body = await readJsonBody<RefreshRequest>(request, 16_384);
		if (typeof body.envelope !== 'string') {
			throw new PublicError(400, 'CREDENTIAL_REQUIRED', '암호화된 로그인 정보가 필요합니다.');
		}

		const sessionBinding = cookies.get(SESSION_BINDING_COOKIE);
		const decrypted = decryptTokenEnvelope(body.envelope);
		assertSessionBinding(decrypted.payload, sessionBinding);
		let payload = decrypted.payload;
		let credential = decrypted.needsKeyRotation
			? toTokenEnvelopeRecord(payload, encryptTokenPayload(payload))
			: null;

		if (isExpiring(payload.accessTokenExpiresAt)) {
			payload = await refreshCafe24Token(payload);
			credential = toTokenEnvelopeRecord(payload, encryptTokenPayload(payload));
			cookies.set(SESSION_BINDING_COOKIE, sessionBinding!, {
				path: '/',
				httpOnly: true,
				secure: secureCookie(url),
				sameSite: 'strict',
				maxAge: sessionCookieMaxAge(payload.refreshTokenExpiresAt)
			});
		}

		return jsonNoStore({ ok: true, auth: toAuthStatus(payload), credential });
	} catch (error) {
		return errorResponse(error);
	}
};

function isExpiring(value: string) {
	const timestamp = Date.parse(value);
	return !Number.isFinite(timestamp) || timestamp <= Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;
}

function sessionCookieMaxAge(refreshTokenExpiresAt: string) {
	const seconds = Math.floor((Date.parse(refreshTokenExpiresAt) - Date.now()) / 1000);
	return Math.max(60, Math.min(seconds, 14 * 24 * 60 * 60));
}

function toAuthStatus(payload: TokenPayload): AuthStatus {
	return {
		mallId: payload.mallId,
		shopNo: payload.shopNo,
		userId: payload.userId,
		accessTokenExpiresAt: payload.accessTokenExpiresAt,
		refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
		scopes: [...payload.scopes]
	};
}
