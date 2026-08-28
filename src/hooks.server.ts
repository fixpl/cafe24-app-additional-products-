import type { Handle } from '@sveltejs/kit';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) {
			response.headers.set(name, value);
		}
	}

	if (
		!response.headers.has('Cache-Control') &&
		(event.url.pathname.startsWith('/api/') || event.url.pathname.startsWith('/auth/'))
	) {
		response.headers.set('Cache-Control', 'no-store, max-age=0');
	}

	if (event.url.protocol === 'https:' && !response.headers.has('Strict-Transport-Security')) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return response;
};
