import {
	assertSessionBinding,
	decryptTokenEnvelope,
	encryptTokenPayload,
	toTokenEnvelopeRecord
} from '$lib/server/cafe24/crypto';
import { SESSION_BINDING_COOKIE } from '$lib/server/env';
import {
	PublicError,
	assertSameOrigin,
	errorResponse,
	jsonNoStore,
	readJsonBody
} from '$lib/server/http';
import type { RequestHandler } from './$types';

interface StatusRequest {
	envelope?: unknown;
}

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		const body = await readJsonBody<StatusRequest>(request, 16_384);
		if (typeof body.envelope !== 'string') {
			throw new PublicError(400, 'CREDENTIAL_REQUIRED', '암호화된 로그인 정보가 필요합니다.');
		}
		const decrypted = decryptTokenEnvelope(body.envelope);
		assertSessionBinding(decrypted.payload, cookies.get(SESSION_BINDING_COOKIE));
		const credential = decrypted.needsKeyRotation
			? toTokenEnvelopeRecord(decrypted.payload, encryptTokenPayload(decrypted.payload))
			: null;
		return jsonNoStore({
			ok: true,
			auth: {
				connected: true,
				mallId: decrypted.payload.mallId,
				shopNo: decrypted.payload.shopNo,
				userId: decrypted.payload.userId,
				accessTokenExpiresAt: decrypted.payload.accessTokenExpiresAt,
				refreshTokenExpiresAt: decrypted.payload.refreshTokenExpiresAt,
				scopes: [...decrypted.payload.scopes]
			},
			credential
		});
	} catch (error) {
		return errorResponse(error);
	}
};
