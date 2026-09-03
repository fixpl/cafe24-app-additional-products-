import * as XLSX from 'xlsx';

export async function readAdditionalProductsFile(file: File) {
	const extension = file.name.trim().toLowerCase().split('.').pop();
	if (extension === 'csv') return file.text();
	if (extension !== 'xlsx') {
		throw new Error('CSV 또는 XLSX 파일만 업로드할 수 있습니다.');
	}

	const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
		throw new Error('XLSX 파일에서 읽을 시트를 찾지 못했습니다.');
	}

	return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName], {
		blankrows: false,
		forceQuotes: false
	});
}
