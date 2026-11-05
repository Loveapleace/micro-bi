import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Alert, Button, Space, TreeSelect } from 'antd';
import { HybridCellDesigner, type HybridCellDesignerRef } from '../../src/cell-designer/HybridCellDesigner';
import { ChartConfigPanel, type ChartConfigPanelRef } from '../../src/ui/ChartConfigPanel';
import { createChartConfig } from '../../src/chart/types';
import { registerDatasets } from '../../src/core/datasetRegistry';
import { createEmbeddedRoot } from './roots';
import type { DesignerHandle, DesignerOptions, ReportDefinition } from '../index';
import univerCss from '@univerjs/preset-sheets-core/lib/index.css?inline';

function installStyles() {
  if (document.querySelector('style[data-micro-bi-univer]')) return;
  const style = document.createElement('style');
  style.dataset.microBiUniver = 'true'; style.textContent = univerCss;
  document.head.appendChild(style);
}
export function mount(element: HTMLElement, initial: DesignerOptions): DesignerHandle {
  element.dataset.microBiDesigner = 'true';
  installStyles();
  const root = createEmbeddedRoot(element);
  let save: (() => Promise<ReportDefinition>) | undefined;
  let datasetSignature = '';
  function Designer({ options }: { options: DesignerOptions }) {
    const datasets = useMemo(() => options.datasets.map(ds => ({ ...ds, data: [] })), [JSON.stringify(options.datasets)]);
    const variableValues = useMemo(() => options.variableValues, [JSON.stringify(options.variableValues || {})]);
    const table = useRef<HybridCellDesignerRef>(null), chart = useRef<ChartConfigPanelRef>(null);
    const [chartConfig, setChartConfig] = useState(() => options.definition?.chartConfig || createChartConfig(options.snapshot.datasetId || options.datasets[0]?.id || ''));
    const [variable, setVariable] = useState<string>(), [insertionError, setInsertionError] = useState('');
    const ready = options.snapshot.datasetId && options.datasets.some(ds => ds.id === options.snapshot.datasetId);
    useEffect(() => { if (options.renderer === 'chart' && chartConfig.datasetId) options.onDatasetChange(chartConfig.datasetId); }, [chartConfig.datasetId, options.onDatasetChange]);
    save = async () => {
      if (!ready) throw new Error('请选择数据源');
      if (options.renderer === 'chart') {
        const result = chart.current?.validateAndGetChart();
        if (!result?.valid) throw new Error(result?.issues.map(i => i.message).join('；') || '图表配置未就绪');
        const config = chart.current!.getConfig();
        return { kind: 'micro-bi-report', version: 1, renderer: 'chart', datasetId: config.datasetId, chartConfig: config };
      }
      const result = await table.current?.validateAndGetReport();
      if (!result?.valid) throw new Error(result?.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('；') || '报表配置未就绪');
      const template = table.current!.getTemplate();
      return { kind: 'micro-bi-report', version: 1, renderer: 'table', datasetId: template.regions[0]?.datasetId || options.snapshot.datasetId, template };
    };
    const tree = useMemo(() => {
      const roots: any[] = [];
      for (const definition of options.variables || []) {
        let siblings = roots;
        for (const [index, name] of (definition.path || []).entries()) {
          const key = `group:${(definition.path || []).slice(0, index + 1).join('/')}`;
          let node = siblings.find(n => n.key === key);
          if (!node) { node = { key, value: key, title: name, selectable: false, children: [] }; siblings.push(node); }
          siblings = node.children;
        }
        siblings.push({ key: definition.id, value: definition.id, title: definition.name });
      }
      return roots;
    }, [JSON.stringify(options.variables || [])]);
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {options.renderer === 'table' && Boolean(options.variables?.length) && <Space style={{ padding: 8, flexShrink: 0 }}>
        <TreeSelect aria-label="选择宿主变量" showSearch treeNodeFilterProp="title" style={{ width: 320 }} placeholder="选择平台变量" value={variable} treeData={tree} onChange={setVariable}/>
        <Button onClick={() => { if (!variable || !table.current?.insertVariable(variable)) setInsertionError('请先在模板设计态选择数据区域外的静态或空白单元格'); else setInsertionError(''); }}>插入变量</Button>
      </Space>}
      {insertionError && <Alert type="warning" message={insertionError} closable onClose={() => setInsertionError('')}/>}
      <div style={{ flex: 1, minHeight: 0 }}>
        {options.renderer === 'table'
          ? <HybridCellDesigner ref={table} datasets={datasets} initialDocument={options.definition?.template} datasetId={options.definition?.datasetId || options.snapshot.datasetId || options.datasets[0]?.id}
            externalDataset={options.snapshot} onDatasetChange={options.onDatasetChange} onRefresh={options.onRefresh} variableValues={variableValues} onVariableReferencesChange={options.onVariableReferencesChange}/>
          : <ChartConfigPanel ref={chart} datasets={datasets} value={chartConfig} onChange={setChartConfig} externalDataset={options.snapshot} onDatasetChange={options.onDatasetChange} onRefresh={options.onRefresh}/>}
      </div>
    </div>;
  }
  const update = (options: DesignerOptions) => {
    const signature = JSON.stringify(options.datasets);
    if (signature !== datasetSignature) { datasetSignature = signature; registerDatasets(options.datasets.map(ds => ({ ...ds, data: [] }))); }
    root.render(<Designer options={options}/>);
  };
  update(initial);
  return { update, save: async () => { if (!save) throw new Error('设计器正在初始化'); return save(); }, unmount: root.unmount };
}
