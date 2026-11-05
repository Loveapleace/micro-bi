import type { DesignerHandle, DesignerOptions, ViewerHandle, ViewerOptions, DetailReportOptions, ReportDefinition } from '../index';

export async function mountDesigner(element: HTMLElement, options: DesignerOptions): Promise<DesignerHandle> {
  const { mount } = await import('./designer');
  return mount(element, options);
}
export async function mountViewer(element: HTMLElement, options: ViewerOptions): Promise<ViewerHandle> {
  const { mount } = await import('./viewer');
  return mount(element, options);
}
export async function createDetailReport(options: DetailReportOptions): Promise<ReportDefinition> {
  const { createDetailReportTemplate } = await import('../../src/report-template/detailPreset');
  return { kind: 'micro-bi-report', version: 1, renderer: 'table', datasetId: options.datasetId, template: createDetailReportTemplate(options) };
}
