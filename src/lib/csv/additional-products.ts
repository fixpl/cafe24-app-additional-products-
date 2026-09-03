import type {
	AdditionalProductInputOperation,
	CsvIssue,
	ProductIdentifier
} from '$lib/shared/types';

export type {
	AdditionalProductMethod,
	AdditionalProductInputOperation,
	AdditionalProductOperation,
	CsvIssue
} from '$lib/shared/types';

interface ParsedCsvRow {
	row: number;
	cells: string[];
}

const LEGACY_METHOD_HEADER = '처리방식';
const PRODUCT_NO_HEADER = '기준상품번호';
const ADDITIONAL_PRODUCT_HEADERS = Array.from(
	{ length: 10 },
	(_, index) => `추가구성상품번호${index + 1}`
);
const EXPECTED_HEADERS = [PRODUCT_NO_HEADER, ...ADDITIONAL_PRODUCT_HEADERS];
const RECOGNIZED_HEADER_SET = new Set([...EXPECTED_HEADERS, LEGACY_METHOD_HEADER]);
const MAX_DATA_ROWS = 500;
const MAX_PRODUCT_NO = 2_147_483_647;
const PRODUCT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

function parseCsv(text: string): { rows: ParsedCsvRow[]; issues: CsvIssue[] } {
	const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
	const rows: ParsedCsvRow[] = [];
	const issues: CsvIssue[] = [];
	let cells: string[] = [];
	let field = '';
	let inQuotes = false;
	let rowStarted = false;
	let line = 1;
	let rowStartLine = 1;

	const finishRow = () => {
		cells.push(field);
		rows.push({ row: rowStartLine, cells });
		cells = [];
		field = '';
		rowStarted = false;
	};

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];

		if (inQuotes) {
			if (character === '"') {
				if (source[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
				continue;
			}

			field += character;
			if (character === '\r') {
				if (source[index + 1] === '\n') {
					field += '\n';
					index += 1;
				}
				line += 1;
			} else if (character === '\n') {
				line += 1;
			}
			continue;
		}

		if (character === '"' && field.length === 0) {
			inQuotes = true;
			rowStarted = true;
			continue;
		}

		if (character === ',') {
			cells.push(field);
			field = '';
			rowStarted = true;
			continue;
		}

		if (character === '\r' || character === '\n') {
			finishRow();
			if (character === '\r' && source[index + 1] === '\n') {
				index += 1;
			}
			line += 1;
			rowStartLine = line;
			continue;
		}

		field += character;
		rowStarted = true;
	}

	if (inQuotes) {
		issues.push({ row: rowStartLine, message: '닫히지 않은 인용부호가 있습니다.' });
	}

	if (rowStarted || cells.length > 0 || field.length > 0) {
		finishRow();
	}

	return { rows, issues };
}

function isBlankRow(cells: string[]): boolean {
	return cells.every((cell) => cell.trim() === '');
}

function validateHeaders(headerRow: ParsedCsvRow): CsvIssue[] {
	const issues: CsvIssue[] = [];
	const seenHeaders = new Set<string>();

	for (const header of headerRow.cells) {
		if (seenHeaders.has(header)) {
			issues.push({
				row: headerRow.row,
				column: header || undefined,
				message: `중복된 헤더입니다: ${header || '(빈 헤더)'}`
			});
		} else {
			seenHeaders.add(header);
		}

		if (!RECOGNIZED_HEADER_SET.has(header)) {
			issues.push({
				row: headerRow.row,
				column: header || undefined,
				message: `알 수 없는 헤더입니다: ${header || '(빈 헤더)'}`
			});
		}
	}

	for (const expectedHeader of EXPECTED_HEADERS) {
		if (!seenHeaders.has(expectedHeader)) {
			issues.push({
				row: headerRow.row,
				column: expectedHeader,
				message: `필수 헤더가 없습니다: ${expectedHeader}`
			});
		}
	}

	return issues;
}

function parseProductIdentifier(value: string): ProductIdentifier | undefined {
	const normalized = value.trim();
	if (/^\d+$/.test(normalized)) {
		const parsed = Number(normalized);
		return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_PRODUCT_NO ? parsed : undefined;
	}
	return PRODUCT_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function identifierKey(value: ProductIdentifier) {
	return typeof value === 'number' ? `number:${value}` : `code:${value}`;
}

function indexHeaders(headers: string[]): Map<string, number> {
	return new Map(headers.map((header, index) => [header, index]));
}

export function parseAdditionalProductsCsv(text: string): {
	operations: AdditionalProductInputOperation[];
	issues: CsvIssue[];
} {
	const parsed = parseCsv(text);
	const issues = [...parsed.issues];
	const operations: AdditionalProductInputOperation[] = [];
	const headerIndex = parsed.rows.findIndex((row) => !isBlankRow(row.cells));

	if (headerIndex === -1) {
		issues.push({ row: 1, message: '헤더 행이 없습니다.' });
		return { operations, issues };
	}

	const headerRow = parsed.rows[headerIndex];
	const headerIssues = validateHeaders(headerRow);
	issues.push(...headerIssues);
	if (headerIssues.length > 0 || parsed.issues.some((issue) => issue.row === headerRow.row)) {
		return { operations, issues };
	}

	const headerIndexes = indexHeaders(headerRow.cells);
	const productNoIndex = headerIndexes.get(PRODUCT_NO_HEADER)!;
	const additionalProductIndexes = ADDITIONAL_PRODUCT_HEADERS.map((header) =>
		headerIndexes.get(header)!
	);
	const syntaxIssueRows = new Set(parsed.issues.map((issue) => issue.row));
	const dataRows = parsed.rows
		.slice(headerIndex + 1)
		.filter((row) => !isBlankRow(row.cells) || syntaxIssueRows.has(row.row));
	const rowsWithinLimit = dataRows.slice(0, MAX_DATA_ROWS);

	if (dataRows.length > MAX_DATA_ROWS) {
		issues.push({
			row: dataRows[MAX_DATA_ROWS].row,
			message: `데이터 행은 최대 ${MAX_DATA_ROWS}개까지 처리할 수 있습니다.`
		});
	}

	const firstRowByProductIdentifier = new Map<string, number>();

	for (const dataRow of rowsWithinLimit) {
		if (syntaxIssueRows.has(dataRow.row)) {
			continue;
		}

		const rowIssues: CsvIssue[] = [];
		const productNo = parseProductIdentifier(dataRow.cells[productNoIndex] ?? '');
		if (productNo === undefined) {
			rowIssues.push({
				row: dataRow.row,
				column: PRODUCT_NO_HEADER,
				message: `기준상품번호는 1 이상 ${MAX_PRODUCT_NO} 이하의 정수 또는 상품코드여야 합니다.`
			});
		} else {
			const productKey = identifierKey(productNo);
			const firstRow = firstRowByProductIdentifier.get(productKey);
			if (firstRow !== undefined) {
				rowIssues.push({
					row: dataRow.row,
					column: PRODUCT_NO_HEADER,
					message: `기준상품번호 ${productNo}가 파일에서 중복되었습니다 (첫 행: ${firstRow}).`
				});
			} else {
				firstRowByProductIdentifier.set(productKey, dataRow.row);
			}
		}

		const additionalProducts: ProductIdentifier[] = [];
		let enteredAdditionalProductCount = 0;

		for (let index = 0; index < additionalProductIndexes.length; index += 1) {
			const column = ADDITIONAL_PRODUCT_HEADERS[index];
			const rawValue = dataRow.cells[additionalProductIndexes[index]] ?? '';
			if (rawValue.trim() === '') {
				continue;
			}

			enteredAdditionalProductCount += 1;
			const additionalProductNo = parseProductIdentifier(rawValue);
			if (additionalProductNo === undefined) {
				rowIssues.push({
					row: dataRow.row,
					column,
					message: `${column}는 1 이상 ${MAX_PRODUCT_NO} 이하의 정수 또는 상품코드여야 합니다.`
				});
				continue;
			}

			additionalProducts.push(additionalProductNo);
		}

		const extraValues = dataRow.cells
			.slice(headerRow.cells.length)
			.filter((value) => value.trim() !== '');
		enteredAdditionalProductCount += extraValues.length;

		if (enteredAdditionalProductCount === 0) {
			rowIssues.push({
				row: dataRow.row,
				column: ADDITIONAL_PRODUCT_HEADERS[0],
				message: '추가구성상품번호는 1개 이상 입력해야 합니다.'
			});
		}

		if (enteredAdditionalProductCount > ADDITIONAL_PRODUCT_HEADERS.length) {
			rowIssues.push({
				row: dataRow.row,
				message: `추가구성상품번호는 최대 ${ADDITIONAL_PRODUCT_HEADERS.length}개까지 입력할 수 있습니다.`
			});
		}

		const seenAdditionalProducts = new Set<string>();
		for (const additionalProductNo of additionalProducts) {
			const additionalProductKey = identifierKey(additionalProductNo);
			if (seenAdditionalProducts.has(additionalProductKey)) {
				rowIssues.push({
					row: dataRow.row,
					message: `추가구성상품번호가 중복되었습니다: ${additionalProductNo}`
				});
			} else {
				seenAdditionalProducts.add(additionalProductKey);
			}
		}

		if (productNo !== undefined && seenAdditionalProducts.has(identifierKey(productNo))) {
			rowIssues.push({
				row: dataRow.row,
				message: '기준상품번호와 동일한 추가구성상품번호는 사용할 수 없습니다.'
			});
		}

		issues.push(...rowIssues);
		if (rowIssues.length === 0 && productNo !== undefined) {
			operations.push({
				row: dataRow.row,
				productNo,
				additionalProducts
			});
		}
	}

	return { operations, issues };
}

export function createTemplateCsv(): string {
	return `\uFEFF${EXPECTED_HEADERS.join(',')}\r\n`;
}
