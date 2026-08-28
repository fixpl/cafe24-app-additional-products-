import {
	assertSessionBinding,
	decryptTokenEnvelope,
	encryptTokenPayload,
	toTokenEnvelopeRecord
} from '$lib/server/cafe24/crypto';
import { SESSION_BINDING_COOKIE, TOKEN_CLAIM_COOKIE, secureCookie } from '$lib/server/env';
import { PublicError, assertSameOrigin, errorResponse, jsonNoStore } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		const envelope = cookies.get(TOKEN_CLAIM_COOKIE);
		if (!envelope) {
			throw new PublicError(
				401,
				'TOKEN_CLAIM_MISSING',
				'전달할 Cafe24 로그인 정보가 없습니다.',
				true
			);
		}
		cookies.delete(TOKEN_CLAIM_COOKIE, {
			secure: secureCookie(url),
			sameSite: 'strict',
			path: '/api/auth/claim'
		});
		const decrypted = decryptTokenEnvelope(envelope);
		assertSessionBinding(decrypted.payload, cookies.get(SESSION_BINDING_COOKIE));
		const currentEnvelope = decrypted.needsKeyRotation
			? encryptTokenPayload(decrypted.payload)
			: envelope;
		return jsonNoStore(toTokenEnvelopeRecord(decrypted.payload, currentEnvelope));
	} catch (error) {
		return errorResponse(error);
	}
};
