import type { UploadJobRecord } from '$lib/shared/types';

const RESULT_HEADERS = [
	'처리행',
	'기준상품번호',
	'요청 추가구성상품번호',
	'Cafe24 응답 추가구성상품번호',
	'처리방식',
	'HTTP 상태',
	'응답 총 개수',
	'결과',
	'Cafe24 응답 메시지'
] as const;

type ResultRecord = Pick<UploadJobRecord, 'results'>;

export function createUploadResultsCsv(record: ResultRecord): string {
	const rows = record.results.map((result) =>
		[
			result.row,
			result.productNo,
			formatProductNumbers(result.requestedAdditionalProducts),
			formatProductNumbers(result.returnedAdditionalProducts),
			result.method ?? '-',
			result.httpStatus ?? '-',
			result.totalCount ?? '-',
			result.ok ? '성공' : '실패',
			result.message
		]
			.map(escapeCsvCell)
			.join(',')
	);

	return `\uFEFF${RESULT_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

export function createUploadResultsFileName(fileName: string): string {
	const baseName = fileName.trim().replace(/\.csv$/i, '') || 'cafe24-additional-products';
	return `${baseName}-results.csv`;
}

function formatProductNumbers(value: number[] | null | undefined): string {
	return value && value.length > 0 ? value.join(' | ') : '-';
}

function escapeCsvCell(value: string | number): string {
	let normalized = String(value).replace(/\r\n?/g, '\n');
	if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
	return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}
