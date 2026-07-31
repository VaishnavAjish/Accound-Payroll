import * as XLSX from 'xlsx';

export function exportToExcel(data, fileName = 'export.xlsx', sheetName = 'Sheet1') {
  const safeFileName = String(fileName || 'export.xlsx').toLowerCase().endsWith('.xlsx')
    ? fileName
    : `${fileName || 'export'}.xlsx`;
  const worksheet = XLSX.utils.json_to_sheet(data);
  
  if (data && data.length > 0) {
    const max_widths = [];
    const keys = Object.keys(data[0]);
    
    // Initialize widths with header lengths
    keys.forEach((key, colIndex) => {
      max_widths[colIndex] = Math.max(12, key.length + 3);
    });

    // Auto-fit widths and format cells based on data type and headers
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    for (let r = range.s.r + 1; r <= range.e.r; r++) { // skip header row
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellAddress];
        if (!cell) continue;

        const header = keys[c] || '';
        const lowerHeader = header.toLowerCase();
        let cellVal = cell.v;

        // Try to parse numeric strings to actual numbers (except for code columns)
        if (typeof cellVal === 'string' && cellVal !== '' && !lowerHeader.includes('code') && !isNaN(Number(cellVal)) && cellVal !== 'HIDDEN' && cellVal !== '—') {
          cellVal = Number(cellVal);
          cell.v = cellVal;
          cell.t = 'n';
        }

        const valStr = cellVal !== undefined && cellVal !== null ? cellVal.toString() : '';
        max_widths[c] = Math.max(max_widths[c], valStr.length + 3);

        // Convert number strings if they aren't parsed as numbers by SheetJS, or handle numeric formats
        if (typeof cellVal === 'number' || cell.t === 'n') {
          cell.t = 'n'; // set type as number
          if (lowerHeader.includes('salary') || lowerHeader.includes('rate') || lowerHeader.includes('payable') || lowerHeader.includes('total') || lowerHeader.includes('amount')) {
            cell.z = '"₹"#,##0.00'; // Indian Rupee currency format
          } else if (lowerHeader.includes('weight') || lowerHeader.includes('wt') || lowerHeader.includes('ct') || lowerHeader.includes('diff')) {
            cell.z = '#,##0.00'; // Decimal weight/difference format
          } else if (lowerHeader.includes('percent') || lowerHeader.includes('yield') || lowerHeader.includes('pct')) {
            cell.z = '0.0%'; // Percentage format
          } else if (Number.isInteger(cellVal)) {
            cell.z = '#,##0'; // Integer format
          } else {
            cell.z = '#,##0.00'; // Default decimal format
          }
        }
      }
    }

    worksheet['!cols'] = max_widths.map(w => ({ wch: w }));
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, safeFileName, { bookType: 'xlsx' });
}
