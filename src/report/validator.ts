/**
 * 报表模型静态校验器 (validator.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 校验 ReportDocument 与 PublishedReport 的合法性并产出结构化诊断。
 */
import type {
  ReportDocument,
  PublishedReport,
  ReportDiagnostic,
  ReportCellMerge,
} from './types.js';

export function validateReportDocument(doc: unknown): {
  valid: boolean;
  issues: ReportDiagnostic[];
} {
  const issues: ReportDiagnostic[] = [];

  if (!doc || typeof doc !== 'object') {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '报表文档必须是非空对象',
    });
    return { valid: false, issues };
  }

  const d = doc as Partial<ReportDocument>;

  if (d.version !== '1.0') {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: `不支持的报表文档版本: ${d.version}，当前支持 '1.0'`,
    });
  }

  if (!d.id || typeof d.id !== 'string') {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '报表文档缺少唯一的 id 标识',
    });
  }

  if (!Array.isArray(d.analyses)) {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '报表文档缺少 analyses 数组',
    });
  }

  const valid = !issues.some((i) => i.severity === 'error');
  return { valid, issues };
}

export function validatePublishedReport(publication: unknown): {
  valid: boolean;
  issues: ReportDiagnostic[];
} {
  const issues: ReportDiagnostic[] = [];

  if (!publication || typeof publication !== 'object') {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '发布模型必须是非空对象',
    });
    return { valid: false, issues };
  }

  const p = publication as Partial<PublishedReport>;

  if (p.version !== '1.0') {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: `不支持的发布模型版本: ${p.version}，当前支持 '1.0'`,
    });
  }

  if (!p.id) {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '发布模型缺少唯一的 id 标识',
    });
  }

  if (!Array.isArray(p.sheets) || p.sheets.length === 0) {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_UNSUPPORTED',
      message: '发布模型中至少需要包含一个有效工作表 (sheet)',
    });
  } else {
    for (const sheet of p.sheets) {
      if (!sheet.id || !sheet.name) {
        issues.push({
          severity: 'error',
          code: 'SCHEMA_UNSUPPORTED',
          message: '工作表缺少 id 或 name',
        });
      }

      // 校验合并单元格坐标合法性
      if (Array.isArray(sheet.merges)) {
        for (let i = 0; i < sheet.merges.length; i++) {
          const m: ReportCellMerge = sheet.merges[i]!;
          if (m.startRow > m.endRow || m.startCol > m.endCol) {
            issues.push({
              severity: 'error',
              code: 'BINDING_INVALID',
              sheetId: sheet.id,
              message: `工作表 ${sheet.name} 中存在倒置的合并区域 [${m.startRow}, ${m.startCol}] - [${m.endRow}, ${m.endCol}]`,
            });
          }
        }
      }
    }
  }

  const valid = !issues.some((i) => i.severity === 'error');
  return { valid, issues };
}
