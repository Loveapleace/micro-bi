import { compilePanelToCellTemplate } from './panelToTemplateAdapter.js';
import type { CellTemplateDocumentV1 } from './types.js';

export interface DetailReportPreset {
  datasetId: string;
  title: string;
  fields: { key: string; label?: string | undefined }[];
  timeField?: string | undefined;
}

/** Seed a controlled detail template, without importing a workbook or embedding facts. */
export function createDetailReportTemplate(options: DetailReportPreset): CellTemplateDocumentV1 {
  if (!options.datasetId.trim() || !options.title.trim()) throw new Error('请选择数据源并填写报表名称');
  const keys = options.fields.map(field => field.key);
  if (!keys.length || keys.some(key => !key.trim()) || new Set(keys).size !== keys.length) throw new Error('明细字段不能为空或重复');
  if (options.timeField && !keys.includes(options.timeField)) throw new Error('时间字段不在明细字段中');
  const headers = Object.fromEntries(options.fields.map(field => [field.key, field.label || field.key]));
  const template = compilePanelToCellTemplate({ datasetId: options.datasetId, headers, dimensions: { categories: [] },
    columns: options.fields.map(field => ({ type: 'fixed', field: field.key, label: headers[field.key] })) }, options.datasetId,
  { archetype: 'detail', datasetName: options.title, sheetName: '历史明细' });
  template.title = options.title.trim();
  for (const cell of template.cells) {
    if (cell.id === 'title' && cell.content.kind === 'literal') {cell.content.value = template.title;cell.literalOverride = true;}
    if (cell.content.kind === 'field') {
      const time = cell.content.fieldKey === options.timeField;
      cell.content.format = time ? 'date' : 'default';
      cell.formatOptions = cell.content.formatOptions = { format: cell.content.format,
        numberFormat: time ? 'yyyy-mm-dd hh:mm:ss' : 'General' };
    }
  }
  template.layoutRules.push(...options.fields.map((field, index) => ({ id: `preset-column-${index}`, kind: 'column-width' as const,
    sheetId: template.sheets[0]!.id, index, size: field.key === options.timeField ? 210 : 160, source: 'preset' as const })));
  return template;
}
