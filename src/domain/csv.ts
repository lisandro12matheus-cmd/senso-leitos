export interface ExportRow { [key: string]: string | number | null | undefined; }

function safeText(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  const protectedValue = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function toCsv(rows: ExportRow[], columns: Array<{ label: string; key: string }>): string {
  const head = columns.map((column) => safeText(column.label)).join(';');
  const body = rows.map((row) => columns.map((column) => safeText(row[column.key])).join(';'));
  return `\uFEFF${[head, ...body].join('\r\n')}`;
}

export function downloadCsv(filename: string, rows: ExportRow[], columns: Array<{ label: string; key: string }>): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 250);
}


