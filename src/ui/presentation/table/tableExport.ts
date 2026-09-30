/**
 * 表格数据导出与剪贴板实用工具 (零外部重型依赖)
 * - exportToCsv: 纯前端 CSV 导出（自动注入 UTF-8 BOM，在 Windows / Mac Excel 中双击 100% 无乱码）
 * - exportToHtmlExcel: 生成标准 XML/HTML 格式的 .xls 工作表，支持列样式与单元格保留
 * - copyToClipboardAsTsv: 格式化为 TSV (Tab Separated) 写入剪贴板，支持直接 Ctrl+V 粘贴进本地 Excel
 */
import type { DataRecord, OutputColumnMeta } from '../../../engine/types.js';

export interface ExportColumnDef {
  key: string;
  title: string;
}

/** HTML 特殊字符转义，防范导出为 HTML/XML Excel 时的 XSS 与标签注入 */
function escapeHtml(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 转义 CSV 单元格内容，并防范 CSV 公式注入 (CWE-1236 / OWASP) */
function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // 防范公式注入：如果为非数字类型且首字符为 =、+、-、@、\t、\r，前置单引号转义
  if (typeof val !== 'number' && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 格式化生成 CSV 文本内容（注入 UTF-8 BOM） */
export function generateCsvContent(
  data: readonly DataRecord[],
  columns: readonly ExportColumnDef[]
): string {
  const headerRow = columns.map((col) => escapeCsvCell(col.title)).join(',');
  const dataRows = data.map((row) =>
    columns.map((col) => escapeCsvCell(row[col.key])).join(',')
  );
  // \uFEFF 为 UTF-8 BOM，确保 Excel 双击以 UTF-8 打开而不是 ANSI
  return '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
}

/** 触发前端文件下载 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出为 CSV 文件 */
export function exportToCsv(
  data: readonly DataRecord[],
  columns: readonly ExportColumnDef[],
  filename: string = 'export_data'
): void {
  const content = generateCsvContent(data, columns);
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const finalName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  triggerDownload(blob, finalName);
}

/** 导出为 HTML/XML Excel (.xls) 文件（支持样式与原生表格结构，并对文本实施安全实体转义） */
export function exportToHtmlExcel(
  data: readonly DataRecord[],
  columns: readonly ExportColumnDef[],
  filename: string = 'export_data'
): void {
  const headerHtml = columns
    .map(
      (col) =>
        `<th style="background-color: #f2f4f8; font-weight: bold; border: 1px solid #d9d9d9; padding: 6px 10px;">${escapeHtml(col.title)}</th>`
    )
    .join('');

  const rowsHtml = data
    .map((row) => {
      const cells = columns
        .map((col) => {
          const val = row[col.key];
          const text = escapeHtml(val);
          const isNum = typeof val === 'number';
          const align = isNum ? 'right' : 'left';
          return `<td style="border: 1px solid #e8e8e8; padding: 6px 10px; text-align: ${align}; mso-number-format:'\\@';">${text}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const template = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Sheet1</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
      </head>
      <body>
        <table>
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([template], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const finalName = filename.endsWith('.xls') || filename.endsWith('.xlsx') ? filename : `${filename}.xls`;
  triggerDownload(blob, finalName);
}

/** 格式化为 TSV 文本（适用于复制进本地 Excel） */
export function generateTsvContent(
  data: readonly DataRecord[],
  columns: readonly ExportColumnDef[]
): string {
  const headerRow = columns.map((col) => col.title.replace(/\t|\r|\n/g, ' ')).join('\t');
  const dataRows = data.map((row) =>
    columns
      .map((col) => {
        const val = row[col.key];
        if (val === null || val === undefined) return '';
        return String(val).replace(/\t|\r|\n/g, ' ');
      })
      .join('\t')
  );
  return [headerRow, ...dataRows].join('\n');
}

/** 复制表格内容到系统剪贴板（TSV 格式，粘贴到 Excel 自动对齐分列） */
export async function copyToClipboardAsTsv(
  data: readonly DataRecord[],
  columns: readonly ExportColumnDef[]
): Promise<boolean> {
  const tsv = generateTsvContent(data, columns);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(tsv);
      return true;
    } catch {
      // 降级兜底
    }
  }

  // 降级 textarea 复制
  try {
    const textarea = document.createElement('textarea');
    textarea.value = tsv;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
