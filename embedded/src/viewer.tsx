import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Alert, Button, DatePicker, Empty, Input, InputNumber, Pagination, Popover, Select, Space, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { createEmbeddedRoot } from './roots';
import { compileCellReport } from '../../src/report-template/compileCellReport';
import { ReportTableView } from '../../src/ui/presentation/report/ReportTableView';
import { ChartView } from '../../src/ui/presentation/charts/ChartView';
import { queryReportRecords, reportPageRows } from '../../src/ui/presentation/report/queryRecords';
import { runtimeFields } from '../../src/report/runtimeQuery';
import { reportColumns, projectReportSheet } from '../../src/report/viewProjection';
import { fieldErrorPublication, missingReportFields } from '../../src/report/fieldDiagnostics';
import { createLocalDrillQuery } from '../../src/report/drillSession';
import { exportPublishedSheet } from '../../src/ui/presentation/report/exportReport';
import { ReportSortControls, type ReportSortControlsRef } from '../../src/ui/presentation/report/ReportSortControls';
import type { ReportSortHeader } from '../../src/report/sortTypes';
import type { ViewerHandle, ViewerOptions, ReportFilter, ReportQuery } from '../index';

const operators = [['eq', '等于'], ['ne', '不等于'], ['contains', '包含'], ['gt', '大于'], ['gte', '大于等于'], ['lt', '小于'], ['lte', '小于等于'], ['between', '范围'], ['empty', '为空'], ['notEmpty', '不为空']];
function Viewer({ options }: { options: ViewerOptions }) {
  const { definition, snapshot, query } = options;
  const exportScope = useRef<AbortController>();
  useEffect(() => () => exportScope.current?.abort(), [definition, snapshot.records, query.filters, query.sort, query.sortRules, query.timeRange, query.hiddenColumns]);
  const sortControlsRef=useRef<ReportSortControlsRef>(null);
  const openSortHeader=useCallback((header:ReportSortHeader,anchor:{left:number;top:number})=>sortControlsRef.current?.openHeader(header,anchor),[]);
  const variableSignature = JSON.stringify(options.variableValues || {});
  const variableValues = useMemo(() => options.variableValues, [variableSignature]);
  const table = useRef<any>(null), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  const [selectedTimeField, setSelectedTimeField] = useState<string>();
  const chartPane = useRef<HTMLDivElement>(null), [chartHeight, setChartHeight] = useState(350);
  useEffect(() => {
    if (definition.renderer !== 'chart' || !chartPane.current) return;
    const observer = new ResizeObserver(() => setChartHeight(Math.max(80, chartPane.current?.clientHeight || 350)));
    observer.observe(chartPane.current); return () => observer.disconnect();
  }, [definition.renderer]);
  const fields = useMemo(() => runtimeFields(snapshot.records, snapshot.headers), [snapshot.records, snapshot.headers]);
  const available = useMemo(() => new Set(fields.map(f => f.key)), [fields]);
  const missing = useMemo(() => {
    if (!snapshot.records.length) return [];
    return [...new Set([...(definition.template ? missingReportFields(definition.template, [...available]) : []),
      ...query.filters.map(f => f.field).filter(f => f && !available.has(f)), ...(definition.renderer==='chart'&&query.sort && !available.has(query.sort.field) ? [query.sort.field] : []),
      ...(query.timeRange && !available.has(query.timeRange.field) ? [query.timeRange.field] : [])])];
  }, [definition, available, query.filters, query.sort, query.timeRange, snapshot.records.length]);
  const records = useMemo(() => missing.length ? [] : queryReportRecords(snapshot.records, {...query,sort:definition.renderer==='chart'?query.sort:undefined}), [snapshot.records, query.filters, query.match, query.sort, query.timeRange, definition.renderer, missing.join('|')]);
  const compiled = useMemo(() => definition.renderer === 'table'
    ? missing.length ? { publication: fieldErrorPublication(definition.template, missing), valid: false, diagnostics: [] }
      : compileCellReport(definition.template, records, { availableFields: fields.map(f => f.key), variableValues,sortRules:query.sortRules })
    : undefined, [definition, records, fields, variableValues, missing.join('|'), query.sortRules]);
  const report = compiled?.publication;
  const activeSheet = report?.sheets.find(s => s.id === query.activeSheetId) || report?.sheets[0];
  const headerRows = activeSheet?.frozenRowCount || (definition.template
    ? Math.min(...definition.template.cells.filter((c: any) => c.sheetId === activeSheet?.id && c.content.kind === 'field' && c.content.role !== 'column-dimension').map((c: any) => c.position.row), activeSheet?.rowCount || 0) : 0);
  const totalRows = Math.max(0, (activeSheet?.rowCount || 0) - headerRows);
  const columns = useMemo(() => activeSheet ? reportColumns(activeSheet, headerRows) : [], [activeSheet, headerRows]);
  const page = Math.min(query.page, Math.max(0, Math.ceil(totalRows / query.pageSize) - 1));
  const displayed = useMemo(() => report && activeSheet && !missing.length
    ? projectReportSheet(report, activeSheet.id, reportPageRows(activeSheet.rowCount, headerRows, page, query.pageSize),
      columns.filter(c => !query.hiddenColumns.includes(c.key)).map(c => c.index))
    : report, [report, activeSheet, page, query.pageSize, query.hiddenColumns, columns, headerRows, missing.length]);
  const drill = useMemo(() => createLocalDrillQuery(() => ({ records, headers: snapshot.headers })), [records, snapshot.headers]);
  const onReady = useCallback((instance: any) => { table.current = instance; }, []);
  const patch = (next: Partial<ReportQuery>) => options.onQueryChange({ ...query, ...next });
  const resetPage = (next: Partial<ReportQuery>) => patch({ ...next, page: 0 });
  const editFilter = (id: string, next: Partial<ReportFilter>) => resetPage({ filters: query.filters.map(f => f.id === id ? { ...f, ...next } : f) });
  const sourceSortFields = definition.renderer === 'chart' ? new Set([definition.chartConfig?.dimension.field]) : definition.template?.cells.some((c: any) => c.content.kind === 'field' && c.content.role.endsWith('dimension'))
    ? new Set(definition.template.cells.filter((c: any) => c.content.kind === 'field' && c.content.role.endsWith('dimension')).map((c: any) => c.content.fieldKey))
    : undefined;
  const sortFields = fields.filter(f => !sourceSortFields || sourceSortFields.has(f.key));
  const dateFields = fields.filter(f => f.type === 'date');
  const timeField = query.timeRange?.field || (dateFields.some(f => f.key === selectedTimeField) ? selectedTimeField : dateFields[0]?.key);
  useEffect(() => { if (!snapshot.loading && page !== query.page) patch({ page }); }, [page, query.page, snapshot.loading]);
  const exportExcel = async () => {
    if (!report || !activeSheet || exporting) return;
    setExporting(true); setError('');
    exportScope.current?.abort();
    const scope = new AbortController(); exportScope.current = scope;
    try {
      const full = projectReportSheet(report, activeSheet.id, Array.from({ length: activeSheet.rowCount }, (_, i) => i), columns.filter(c => !query.hiddenColumns.includes(c.key)).map(c => c.index));
      await exportPublishedSheet(full, activeSheet.id, scope.signal);
    }
    catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExporting(false); }
  };
  const filterEditor = <Space direction="vertical" style={{ width: 520 }}>
    <Select aria-label="筛选组合" value={query.match} onChange={match => resetPage({ match })} options={[{ value: 'and', label: '满足全部条件' }, { value: 'or', label: '满足任意条件' }]}/>
    {query.filters.map(filter => <Space key={filter.id} wrap>
      <Select aria-label="运行筛选字段" status={available.has(filter.field) ? '' : 'error'} style={{ width: 150 }} value={filter.field || undefined} placeholder="字段" options={fields.map(f => ({ value: f.key, label: f.label }))}
        onChange={field => editFilter(filter.id, { field: field || '', value: undefined, upper: undefined })}/>
      <Select aria-label="运行筛选条件" style={{ width: 110 }} value={filter.operator} options={operators.map(([value, label]) => ({ value, label }))} onChange={operator => editFilter(filter.id, { operator: operator as ReportFilter['operator'] })}/>
      {!['empty', 'notEmpty'].includes(filter.operator) && (fields.find(f => f.key === filter.field)?.type === 'number'
        ? <InputNumber aria-label="运行筛选值" value={typeof filter.value === 'number' ? filter.value : null} onChange={v => editFilter(filter.id, { value: v ?? undefined })}/>
        : <Input aria-label="运行筛选值" style={{ width: 150 }} value={filter.value ?? ''} onChange={e => editFilter(filter.id, { value: e.target.value })}/>)}
      {filter.operator === 'between' && <Input aria-label="范围上限" style={{ width: 120 }} value={filter.upper ?? ''} onChange={e => editFilter(filter.id, { upper: e.target.value })}/>}
      <Button danger onClick={() => resetPage({ filters: query.filters.filter(f => f.id !== filter.id) })}>删除</Button>
    </Space>)}
    <Button onClick={() => resetPage({ filters: [...query.filters, { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, field: fields[0]?.key || '', operator: 'contains', value: '' }] })}>添加条件</Button>
  </Space>;
  return <div data-micro-bi-viewer style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff', color: '#222' }}>
    {options.showToolbar !== false && <Space wrap size={6} style={{ padding: 6, flexShrink: 0 }}>
      {(dateFields.length > 0 || query.timeRange) && <>
        <Select aria-label="时间范围字段" size="small" style={{width:120}} status={timeField && !available.has(timeField) ? 'error' : ''} value={timeField}
          options={dateFields.map(f=>({value:f.key,label:f.label}))} onChange={field=>{if(!field)return;setSelectedTimeField(field);if(query.timeRange)resetPage({timeRange:{...query.timeRange,field}});}}/>
        <DatePicker.RangePicker size="small" showTime format="YYYY-MM-DD HH:mm" style={{width:300}}
          value={query.timeRange ? [dayjs(query.timeRange.from),dayjs(query.timeRange.to)] : null}
          presets={[{label:'今天',value:[dayjs().startOf('day'),dayjs().endOf('day')]},{label:'最近7天',value:[dayjs().subtract(6,'day').startOf('day'),dayjs().endOf('day')]},{label:'本月',value:[dayjs().startOf('month'),dayjs().endOf('day')]}]}
          onChange={range=>resetPage({timeRange:range?.[0]&&range[1]&&timeField?{field:timeField,from:range[0].toISOString(),to:range[1].toISOString()}:undefined})}/>
      </>}
      <Popover trigger="click" placement="bottomLeft" content={filterEditor}><Button size="small">筛选{query.filters.length ? ` (${query.filters.length})` : ''}</Button></Popover>
      {definition.renderer==='table'&&report?.sortCatalog?<ReportSortControls ref={sortControlsRef} catalog={report.sortCatalog} rules={report.sortRules||[]} defaultRules={definition.template?.defaultSortRules||[]}
        disabled={snapshot.loading||missing.length>0} sheetId={activeSheet?.id} onChange={sortRules=>resetPage({sortRules})}/>:null}
      {definition.renderer==='chart'&&<Select aria-label="报表排序字段" size="small" allowClear style={{ width: 150 }} value={query.sort?.field} placeholder="排序字段" options={sortFields.map(f => ({ value: f.key, label: f.label }))}
        onChange={field => resetPage({ sort: field ? { field, order: query.sort?.order || 'asc' } : undefined })}/>}
      {definition.renderer==='chart'&&query.sort && <Select aria-label="报表排序方向" size="small" value={query.sort.order} options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} onChange={order => resetPage({ sort: { ...query.sort!, order } })}/>}
      {definition.renderer === 'table' && <Select aria-label="报表显示列" size="small" mode="multiple" maxTagCount={0} style={{ width: 140 }} placeholder="显示列" value={columns.filter(c => !query.hiddenColumns.includes(c.key)).map(c => c.key)}
        options={columns.map(c => ({ value: c.key, label: c.label }))} onChange={visible => resetPage({ hiddenColumns: columns.filter(c => !visible.includes(c.key)).map(c => c.key) })}/>}
      <Button size="small" onClick={options.onRefresh}>刷新</Button>
      {definition.renderer === 'table' && <Button size="small" loading={exporting} disabled={Boolean(missing.length || snapshot.loading)} onClick={exportExcel}>导出Excel</Button>}
      <Button size="small" onClick={() => options.onQueryChange({ filters: [], match: 'and', hiddenColumns: [], page: 0, pageSize: query.pageSize })}>重置查询</Button>
      <span style={{ fontSize: 12, color: '#666' }}>筛选后 {records.length} / {snapshot.records.length} 条</span>
    </Space>}
    {!!missing.length && <Alert type="error" showIcon message="字段已失配，请编辑报表配置" description={<><span>以下字段已不存在，当前仅展示模板结构：</span>{missing.map(name => <Tag color="error" key={name}>{name}</Tag>)}</>}/>}
    {snapshot.error && <Alert type="error" message={snapshot.error}/>}
    {error && <Alert type="error" message={error} closable onClose={() => setError('')}/>}
    {compiled && !compiled.valid && !missing.length && <Alert type="error" message={compiled.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('；')}/>}
    {!snapshot.records.length && !snapshot.loading && <Alert type="info" message="当前数据源没有数据"/>}
    <div ref={chartPane} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {snapshot.loading && <div style={{ position: 'absolute', right: 8, top: 8, zIndex: 2 }}><Spin size="small"/></div>}
      {definition.renderer === 'table' && displayed
        ? <ReportTableView report={displayed} height="100%" activeSheetId={activeSheet?.id} onActiveSheetChange={activeSheetId => {if (report?.sheets.some(s => s.id === activeSheetId)) patch({ activeSheetId, page: 0 });}} onTableReady={onReady} queryDrillDetails={drill} onSortHeader={options.showToolbar===false?undefined:openSortHeader}/>
        : definition.chartConfig ? <ChartView config={query.sort ? {...definition.chartConfig, sort:{field:'dimension',order:query.sort.order}} : definition.chartConfig} data={records} headers={snapshot.headers} height={chartHeight}/> : <Empty description="报表配置不存在"/>}
    </div>
    {definition.renderer === 'table' && !missing.length && <Pagination size="small" style={{ padding: 6 }} current={page + 1} pageSize={query.pageSize} total={totalRows} pageSizeOptions={[20, 50, 100, 200]} showSizeChanger
      onChange={(next, pageSize) => patch({ page: pageSize !== query.pageSize ? 0 : next - 1, pageSize })} showTotal={total => `${total} 行，统计基于全部筛选记录`}/>}
  </div>;
}

export function mount(element: HTMLElement, options: ViewerOptions): ViewerHandle {
  const root = createEmbeddedRoot(element);
  const update = (next: ViewerOptions) => root.render(<Viewer options={next}/>);
  update(options);
  return { update, unmount: root.unmount };
}
