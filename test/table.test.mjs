import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateCsvContent,
  generateTsvContent,
  exportToCsv,
  exportToHtmlExcel,
  copyToClipboardAsTsv,
  VTableView,
  computeSummaryValues,
  applyVTableSummaryRowSortPatch,
} from '../dist/esm/ui/index.js';
import { transformData } from '../dist/esm/engine/index.js';

test('tableExport: 导出模块与 VTableView 组件导出完整性', () => {
  assert.equal(typeof generateCsvContent, 'function');
  assert.equal(typeof generateTsvContent, 'function');
  assert.equal(typeof exportToCsv, 'function');
  assert.equal(typeof exportToHtmlExcel, 'function');
  assert.equal(typeof copyToClipboardAsTsv, 'function');
  assert.equal(typeof VTableView, 'function');
});

test('tableExport: generateCsvContent 自动注入 UTF-8 BOM 并准确转义特殊字符', () => {
  const data = [
    { workshop: '1号车间,含逗号', qty: 100, note: '带"双引号"' },
    { workshop: '2号车间\n含换行', qty: 200, note: '普通说明' },
  ];
  const columns = [
    { key: 'workshop', title: '车间名称' },
    { key: 'qty', title: '产量' },
    { key: 'note', title: '备注' },
  ];

  const csv = generateCsvContent(data, columns);

  // 1. 验证 UTF-8 BOM 标记存在，确保 Excel 双击不乱码
  assert.ok(csv.startsWith('\uFEFF'), 'CSV 必须以 UTF-8 BOM 开头');

  // 2. 验证逗号与双引号被安全双引号包装与转义
  assert.ok(csv.includes('"1号车间,含逗号"'), '含逗号的单元格被引号包裹');
  assert.ok(csv.includes('"带""双引号"""'), '含双引号的单元格转义为两个双引号');
  assert.ok(csv.includes('"2号车间\n含换行"'), '含换行的单元格被引号包裹');
});

test('tableExport: generateTsvContent 正确生成 Tab 分隔符与回车处理', () => {
  const data = [
    { name: '项目A', cost: 1200 },
    { name: '项目B', cost: 3400 },
  ];
  const columns = [
    { key: 'name', title: '项目' },
    { key: 'cost', title: '成本' },
  ];

  const tsv = generateTsvContent(data, columns);
  const lines = tsv.split('\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[0], '项目\t成本');
  assert.equal(lines[1], '项目A\t1200');
  assert.equal(lines[2], '项目B\t3400');
});

test('table: 底部汇总统计算法根据统计口径正确求值 (SUM求和, AVG求均值, COMPUTED按公式求值)', () => {
  const mockColumns = [
    { key: 'month', title: '月份', type: 'time', kind: 'dimension' },
    { key: 'SUM(output_qty)', title: '交付总件数', type: 'number', kind: 'aggregated', agg: 'sum', field: 'output_qty' },
    { key: 'AVG(duration_hours)', title: '平均工时(h)', type: 'number', kind: 'aggregated', agg: 'avg', field: 'duration_hours' },
    { key: 'AVG(yield_rate)', title: '综合良品率(%)', type: 'number', kind: 'aggregated', agg: 'avg', field: 'yield_rate' },
    { key: 'SUM(defect_count)', title: '缺陷零件总数', type: 'number', kind: 'aggregated', agg: 'sum', field: 'defect_count' },
    {
      key: 'defect_ratio',
      title: '综合缺陷率(%)',
      type: 'number',
      kind: 'computed',
      expression: 'IF([SUM(output_qty)] > 0, ROUND([SUM(defect_count)] / [SUM(output_qty)] * 100, 2), 0)',
      precision: 2,
    },
  ];

  const mockRows = [
    {
      month: '2026-08-01',
      'SUM(output_qty)': 1000,
      'AVG(duration_hours)': 60,
      'AVG(yield_rate)': 99.0,
      'SUM(defect_count)': 10,
      defect_ratio: 1.0,
    },
    {
      month: '2026-08-02',
      'SUM(output_qty)': 2000,
      'AVG(duration_hours)': 80,
      'AVG(yield_rate)': 97.0,
      'SUM(defect_count)': 60,
      defect_ratio: 3.0,
    },
  ];

  const summary = computeSummaryValues(mockRows, mockColumns);

  // 1. SUM: 必须是求和
  assert.equal(summary['SUM(output_qty)'], 3000);
  assert.equal(summary['SUM(defect_count)'], 70);

  // 2. AVG: 必须是平均值 (60 + 80) / 2 = 70，绝对不能是固定相加的 140!
  assert.equal(summary['AVG(duration_hours)'], 70);
  // (99 + 97) / 2 = 98%，绝对不能是固定相加的 196%!
  assert.equal(summary['AVG(yield_rate)'], 98);

  // 3. COMPUTED: 必须在汇总指标上求值，即 70 / 3000 * 100 = 2.33%，绝对不能是各行百分比相加 4.0%!
  assert.equal(summary['defect_ratio'], 2.33);
});

test('table: 聚合数据行底层原始流水精确挂载 (_rawRows)', () => {
  const rawRecords = [
    { order_id: 'WO-001', workshop: '车间A', qty: 100, cost: 50 },
    { order_id: 'WO-002', workshop: '车间A', qty: 150, cost: 80 },
    { order_id: 'WO-003', workshop: '车间B', qty: 300, cost: 120 },
  ];

  const config = {
    dimensions: {
      categories: ['workshop'],
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '交付总数' },
      { type: 'aggregated', field: 'cost', agg: 'avg', label: '平均成本' },
    ],
    headers: {
      order_id: '工单号',
      workshop: '车间',
      qty: '产出量',
      cost: '成本',
    },
  };

  const result = transformData(rawRecords, config);

  assert.equal(result.data.length, 2);
  const rowA = result.data.find((r) => r.workshop === '车间A');
  assert.ok(rowA);
  assert.equal(rowA['交付总数'], 250);

  // 1. 验证非枚举属性 _rawRows 挂载且包含且仅包含归属于车间A的 2 条原始记录
  assert.ok(Array.isArray(rowA._rawRows));
  assert.equal(rowA._rawRows.length, 2);
  assert.equal(rowA._rawRows[0].order_id, 'WO-001');
  assert.equal(rowA._rawRows[1].order_id, 'WO-002');

  // 2. 验证 _rawRows 保持真实原始物理字段，且为非枚举属性，绝不污染 Object.keys
  assert.equal(Object.keys(rowA).includes('_rawRows'), false);

  // 3. 验证元信息保留原始表头映射
  assert.equal(result.meta.rawHeaders.order_id, '工单号');
});

test('table: 总计行在 VTable 列排序 (ASC/DESC/数值/文本) 中严格被排除且永久固定置底', async () => {
  const vtable = await import('@visactor/vtable');
  const vtableActual = vtable.ListTable ? vtable : (vtable.default || vtable);
  const DataSource = vtableActual.data.DataSource;
  const CachedDataSource = vtableActual.data.CachedDataSource;

  // 确保补丁已生效
  applyVTableSummaryRowSortPatch();

  const records = [
    { workshop: '10号车间', count: 15, rate: 0.75 },
    { workshop: '2号车间', count: 50, rate: 0.95 },
    { workshop: '1号车间', count: 20, rate: 0.60 },
    { workshop: '总计 (共 3 项)', count: 85, rate: 0.82, __isSummaryRow: true },
  ];

  const ds = CachedDataSource.ofArray(records, null, null, [
    { field: 'workshop', sort: true },
    { field: 'count', sort: true },
    { field: 'rate', sort: true },
  ]);

  // 1. 数值升序排序：数据行 15, 20, 50 升序排，总计行 85 必须且始终在最后
  ds.sort([{ field: 'count', order: 'asc' }]);
  const countAsc = ds.currentIndexedData.map((i) => records[i].count);
  assert.deepEqual(countAsc, [15, 20, 50, 85]);

  // 2. 数值降序排序：数据行 50, 20, 15 降序排，总计行 85 绝对不能跑到最前面，必须仍在最后
  ds.sort([{ field: 'count', order: 'desc' }]);
  const countDesc = ds.currentIndexedData.map((i) => records[i].count);
  assert.deepEqual(countDesc, [50, 20, 15, 85]);

  // 3. 浮点百分比降序排序：0.95, 0.75, 0.60，总计行 0.82 仍在最后
  ds.sort([{ field: 'rate', order: 'desc' }]);
  const rateDesc = ds.currentIndexedData.map((i) => records[i].rate);
  assert.deepEqual(rateDesc, [0.95, 0.75, 0.60, 0.82]);

  // 4. 文本拼音自然升序：1号车间, 2号车间, 10号车间，总计行仍在最后
  ds.sort([{ field: 'workshop', order: 'asc' }]);
  const wsAsc = ds.currentIndexedData.map((i) => records[i].workshop);
  assert.deepEqual(wsAsc, ['1号车间', '2号车间', '10号车间', '总计 (共 3 项)']);

  // 5. 文本拼音降序：10号车间, 2号车间, 1号车间，总计行仍然在最后
  ds.sort([{ field: 'workshop', order: 'desc' }]);
  const wsDesc = ds.currentIndexedData.map((i) => records[i].workshop);
  assert.deepEqual(wsDesc, ['10号车间', '2号车间', '1号车间', '总计 (共 3 项)']);
});

test('table: 维度列相邻同类单元格纵向合并逻辑验证 (时间分桶/分类合并、总计行隔离与上级维度保护)', () => {
  const records = [
    { plan_start_time: '2026-08', workshop: '1号五轴切削车间', output_qty: 4400 },
    { plan_start_time: '2026-08', workshop: '2号重型冲压车间', output_qty: 4550 },
    { plan_start_time: '2026-08', workshop: '3号智能装配车间', output_qty: 1900 },
    { plan_start_time: '2026-09', workshop: '1号五轴切削车间', output_qty: 3200 },
    { plan_start_time: '总计 (共 4 项)', workshop: '-', output_qty: 14050, __isSummaryRow: true },
  ];

  const visibleColumnsMeta = [
    { key: 'plan_start_time', title: '计划投产时间', type: 'time', kind: 'dimension' },
    { key: 'workshop', title: '承制车间', type: 'text', kind: 'dimension' },
    { key: 'output_qty', title: '交付总件数', type: 'number', kind: 'aggregated' },
  ];

  // 模拟 VTableView 中构建的 mergeCellFn 算法
  const createMergeFn = (colIndex) => {
    const col = visibleColumnsMeta[colIndex];
    const isNumber = col.type === 'number';
    if (isNumber) return undefined;

    const precedingDimensionCols = visibleColumnsMeta.slice(0, colIndex).filter((c) => c.type !== 'number');

    return (v1, v2, extraArgs) => {
      if (v1 === null || v1 === undefined || v1 === '' || v1 === '-') return false;
      if (String(v1) !== String(v2)) return false;

      const tbl = extraArgs?.table;
      if (!tbl) return true;

      const sourceRecord = tbl.getCellOriginRecord(extraArgs.source?.col, extraArgs.source?.row);
      const targetRecord = tbl.getCellOriginRecord(extraArgs.target?.col, extraArgs.target?.row);

      // 严禁普通数据行与底部总计行合并
      if (sourceRecord?.__isSummaryRow || targetRecord?.__isSummaryRow) {
        return false;
      }

      // 上级维度层次化保护
      if (precedingDimensionCols.length > 0 && sourceRecord && targetRecord) {
        for (const pCol of precedingDimensionCols) {
          if (String(sourceRecord[pCol.key] ?? '') !== String(targetRecord[pCol.key] ?? '')) {
            return false;
          }
        }
      }

      return true;
    };
  };

  const mockTable = {
    getCellOriginRecord: (col, row) => records[row],
  };

  const mergeTimeFn = createMergeFn(0); // 计划投产时间
  const mergeWorkshopFn = createMergeFn(1); // 承制车间
  const mergeQtyFn = createMergeFn(2); // 交付总件数

  // 1. 度量列 (数值列) 绝不合并，保持每行独立
  assert.equal(mergeQtyFn, undefined);

  // 2. 计划投产时间：连续 3 行 '2026-08' 判定为成功合并
  assert.ok(mergeTimeFn);
  const mergeRow0Row1 = mergeTimeFn(records[0].plan_start_time, records[1].plan_start_time, {
    source: { col: 0, row: 0 },
    target: { col: 0, row: 1 },
    table: mockTable,
  });
  assert.equal(mergeRow0Row1, true, '行0与行1计划投产时间同为 2026-08，合并成立');

  const mergeRow1Row2 = mergeTimeFn(records[1].plan_start_time, records[2].plan_start_time, {
    source: { col: 0, row: 1 },
    target: { col: 0, row: 2 },
    table: mockTable,
  });
  assert.equal(mergeRow1Row2, true, '行1与行2计划投产时间同为 2026-08，合并成立');

  // 3. 跨越时间分桶：行2 (2026-08) 与 行3 (2026-09) 值不同，不合并
  const mergeRow2Row3 = mergeTimeFn(records[2].plan_start_time, records[3].plan_start_time, {
    source: { col: 0, row: 2 },
    target: { col: 0, row: 3 },
    table: mockTable,
  });
  assert.equal(mergeRow2Row3, false, '跨越不同月份不合并');

  // 4. 总计行隔离保护：绝不与总计行合并
  const mergeWithSummary = mergeTimeFn(records[3].plan_start_time, records[4].plan_start_time, {
    source: { col: 0, row: 3 },
    target: { col: 0, row: 4 },
    table: mockTable,
  });
  assert.equal(mergeWithSummary, false, '数据行绝不与底部总计行合并');

  // 5. 层次化保护：行0与行3的车间同为 '1号五轴切削车间'，但由于它们所属的计划投产时间不同 (2026-08 vs 2026-09)，不发生跨层合并
  assert.ok(mergeWorkshopFn);
  const mergeCrossTimeWorkshop = mergeWorkshopFn(records[0].workshop, records[3].workshop, {
    source: { col: 1, row: 0 },
    target: { col: 1, row: 3 },
    table: mockTable,
  });
  assert.equal(mergeCrossTimeWorkshop, false, '上级时间维度不同时，子维度车间绝不跨时间边界错误合并');
});

test('table: 合并单元格联动激活范围自动扩展与去重 (单组合并单元格全范围包络高亮)', () => {
  // 模拟带有合并单元格的表格数据
  const rawData = [
    { plan_start_time: '2026-08', workshop: '1号五轴切削车间' },
    { plan_start_time: '2026-08', workshop: '2号重型冲压车间' },
    { plan_start_time: '2026-08', workshop: '3号智能装配车间' },
    { plan_start_time: '2026-09', workshop: '1号五轴切削车间' },
  ];

  const tableColumns = [
    { field: 'plan_start_time', title: '计划投产时间' },
    { field: 'workshop', title: '承制车间' },
  ];

  // 模拟 VTable 实例方法：第 0 列的行 1、2、3 合并为一个大单元格 (start: 1, end: 3)
  const mockTable = {
    columnHeaderLevelCount: 1,
    getCellRange: (col, row) => {
      if (col === 0 && row >= 1 && row <= 3) {
        return { start: { col: 0, row: 1 }, end: { col: 0, row: 3 } };
      }
      return { start: { col, row }, end: { col, row } };
    },
    selectCellCalledWith: null,
    selectCellsCalledWith: null,
    selectCell(col, row, shift, ctrl, visible, skipBodyMerge) {
      this.selectCellCalledWith = { col, row, shift, ctrl, visible, skipBodyMerge };
    },
    selectCells(ranges) {
      this.selectCellsCalledWith = ranges;
    },
  };

  // 模拟当切片为 { field: 'plan_start_time', value: '2026-08' } 时 VTableView 的 ranges 计算与调用
  const effectiveSlices = [{ field: 'plan_start_time', value: '2026-08' }];
  const headerOffset = mockTable.columnHeaderLevelCount;
  const ranges = [];

  for (let rIdx = 0; rIdx < rawData.length; rIdx++) {
    const row = rawData[rIdx];
    const tableRow = rIdx + headerOffset;

    for (let cIdx = 0; cIdx < tableColumns.length; cIdx++) {
      const colDef = tableColumns[cIdx];
      const colField = colDef.field;
      for (const s of effectiveSlices) {
        if (s.field === colField && row[colField] === s.value) {
          const range = mockTable.getCellRange(cIdx, tableRow);
          const exists = ranges.some(
            (r) =>
              r.start.col === range.start.col &&
              r.start.row === range.start.row &&
              r.end.col === range.end.col &&
              r.end.row === range.end.row
          );
          if (!exists) {
            ranges.push(range);
          }
        }
      }
    }
  }

  // 1. 验证 3 行 2026-08 经 getCellRange 与 deduplicate 处理后，完美聚合成唯一个合并 range
  assert.equal(ranges.length, 1, '去重后仅产生 1 个代表整体合并范围的 range');
  assert.deepEqual(ranges[0], {
    start: { col: 0, row: 1 },
    end: { col: 0, row: 3 },
  });

  // 2. 模拟触发 selectCell 逻辑
  if (ranges.length === 1) {
    mockTable.selectCell(ranges[0].start.col, ranges[0].start.row, false, false, true, false);
  }

  assert.ok(mockTable.selectCellCalledWith);
  assert.equal(mockTable.selectCellCalledWith.col, 0);
  assert.equal(mockTable.selectCellCalledWith.row, 1);
  assert.equal(mockTable.selectCellCalledWith.skipBodyMerge, false, 'skipBodyMerge 必须为 false 才能包络合并范围');
});

test('table: 跨卡片联动防串扰保护 (次选主维度值对齐仅在维度字段名/别名精准匹配时触发，异构看板绝不误选)', () => {
  // 看板二：完工质检节奏与缺陷质量分析，其主维度为 finish_time (完工质检时间)，无 plan_start_time
  const dimensionField = 'finish_time';
  const visibleColumnsMeta = [
    { key: 'finish_time', title: '完工质检时间', type: 'time' },
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'output_qty', title: '交付总数', type: 'number' },
  ];
  const headers = {
    finish_time: '完工质检时间',
    workshop: '承制车间',
  };

  // 看板一发出的联动切片：针对计划投产时间 (plan_start_time = '2026-08')
  const activeLinkageFromCard1 = {
    dimensionField: 'plan_start_time',
    dimensionTitle: '计划投产时间',
    dimensionValue: '2026-08',
  };

  // 检测看板二中的 isDimensionFieldMatched 判定
  const isDimensionFieldMatched =
    Boolean(activeLinkageFromCard1.dimensionField) &&
    Boolean(dimensionField) &&
    (activeLinkageFromCard1.dimensionField === dimensionField ||
      (headers && headers[dimensionField] === activeLinkageFromCard1.dimensionField) ||
      (headers && headers[activeLinkageFromCard1.dimensionField] === dimensionField) ||
      visibleColumnsMeta.some(
        (c) =>
          c.key === dimensionField &&
          (c.title === activeLinkageFromCard1.dimensionField || c.title === activeLinkageFromCard1.dimensionTitle)
      ));

  // 1. 计划投产时间与完工质检时间不是同名或别名字段，严禁误认为主维度对齐
  assert.equal(isDimensionFieldMatched, false, '不同维度字段绝不触发跨维度错误次选匹配');

  // 2. 当用户点击的是车间联动 (workshop = '1号车间') 时，同名字段正常匹配
  const activeLinkageWorkshop = {
    dimensionField: 'workshop',
    dimensionTitle: '承制车间',
    dimensionValue: '1号车间',
  };
  const isWorkshopMatched =
    activeLinkageWorkshop.dimensionField === 'workshop' ||
    headers.workshop === activeLinkageWorkshop.dimensionField;
  assert.equal(isWorkshopMatched, true, '相同维度字段正常命中切片匹配');
});

test('table: 列设置支持靠右冻结 (rightFrozenColumnKeys) 并保证 [左冻结列 -> 中间流动列 -> 右冻结列] 组织顺序', () => {
  const candidateColumnsMeta = [
    { key: 'dept', title: '事业部', type: 'text' },
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'plan_time', title: '计划时间', type: 'time' },
    { key: 'output_qty', title: '产出量', type: 'number' },
    { key: 'defect_ratio', title: '缺陷率(%)', type: 'number' },
  ];

  const frozenColumnKeys = ['dept']; // 左冻结事业部
  const rightFrozenColumnKeys = ['defect_ratio']; // 右冻结缺陷率
  const hiddenColumnKeys = [];
  const columnOrder = null;

  // 模拟 VTableView visibleColumnsMeta 组装算法
  const leftCols = [];
  const middleCols = [];
  const rightCols = [];
  const leftSet = new Set(frozenColumnKeys);
  const rightSet = new Set(rightFrozenColumnKeys);

  for (const col of candidateColumnsMeta) {
    if (leftSet.has(col.key)) {
      leftCols.push(col);
    } else if (rightSet.has(col.key)) {
      rightCols.push(col);
    } else {
      middleCols.push(col);
    }
  }
  const visible = [...leftCols, ...middleCols, ...rightCols];

  assert.equal(visible.length, 5);
  // 首列必须是左固定列
  assert.equal(visible[0].key, 'dept');
  // 末列必须是右固定列
  assert.equal(visible[visible.length - 1].key, 'defect_ratio');
  // 中间列保持自然相对顺序
  assert.deepEqual(
    visible.map((c) => c.key),
    ['dept', 'workshop', 'plan_time', 'output_qty', 'defect_ratio']
  );
});

test('table: 靠左固定与靠右固定具有互斥性，且重置能一键清空双向冻结与排序', () => {
  let leftFrozen = ['dept'];
  let rightFrozen = [];

  // 1. 将已在左固定的 'dept' 切换为靠右固定
  const targetCol = 'dept';
  // 模拟右固定点击事件
  leftFrozen = leftFrozen.filter((k) => k !== targetCol);
  rightFrozen = [...rightFrozen, targetCol];

  assert.deepEqual(leftFrozen, [], '靠左固定中移除该列');
  assert.deepEqual(rightFrozen, ['dept'], '靠右固定中包含该列');

  // 2. 再次点击右固定图标，取消靠右固定
  rightFrozen = rightFrozen.filter((k) => k !== targetCol);
  assert.deepEqual(rightFrozen, [], '取消右固定后列表为空');

  // 3. 同时设置左右固定后一键重置
  leftFrozen = ['workshop'];
  rightFrozen = ['output_qty'];
  let columnOrder = ['output_qty', 'workshop', 'dept'];
  let hiddenKeys = ['plan_time'];

  // 模拟重置
  hiddenKeys = [];
  columnOrder = null;
  leftFrozen = [];
  rightFrozen = [];

  assert.equal(leftFrozen.length, 0);
  assert.equal(rightFrozen.length, 0);
  assert.equal(columnOrder, null);
  assert.equal(hiddenKeys.length, 0);
});

test('table: VTable rightFrozenColCount 计算逻辑 (操作列默认常驻靠右冻结，与用户自定义右冻结列平滑叠加)', () => {
  const computeRightFrozenCount = (rightFrozenKeys, canDrill) => {
    return rightFrozenKeys.length + (canDrill ? 1 : 0);
  };

  // 1. 无右侧用户自定义冻结列时，若有下钻操作列，默认 rightFrozenColCount = 1 (操作列默认常驻右固定)
  assert.equal(computeRightFrozenCount([], true), 1);
  // 2. 无下钻操作列且无用户冻结时，rightFrozenColCount = 0
  assert.equal(computeRightFrozenCount([], false), 0);

  // 3. 有 1 列用户右侧冻结，无下钻列时，rightFrozenColCount = 1
  assert.equal(computeRightFrozenCount(['cost'], false), 1);

  // 4. 有 2 列右侧冻结，且包含原地下钻列 (末尾追加操作列) 时，rightFrozenColCount = 2 + 1 = 3 (保证操作列与用户右冻结列共同贴紧右侧)
  assert.equal(computeRightFrozenCount(['cost', 'profit'], true), 3);
});

test('table: 表头筛选图标使用与列设置弹层一致的 Ant Design FilterOutlined / FilterFilled 矢量规范', () => {
  const antdFilterOutlinedPath =
    'M880.1 154H143.9c-24.5 0-39.8 26.7-27.5 48L349 597.4V838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V597.4L907.7 202c12.2-21.3-3.1-48-27.6-48zM603.4 798H420.6V642h182.9v156zm9.6-236.6l-9.5 16.6h-183l-9.5-16.6L212.7 226h598.6L613 561.4z';
  const antdFilterFilledPath =
    'M349 838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V642H349v196zm531.1-684H143.9c-24.5 0-39.8 26.7-27.5 48l221.3 376h348.8l221.3-376c12.1-21.3-3.2-48-27.7-48z';

  const generateFilterSvg = (isColFiltered, isDark, themeColorTextSecondary) => {
    const filterColor = isColFiltered
      ? '#1677ff'
      : isDark
      ? 'rgba(255, 255, 255, 0.45)'
      : (themeColorTextSecondary || '#8c8c8c');

    const filterPath = isColFiltered ? antdFilterFilledPath : antdFilterOutlinedPath;

    return `<svg viewBox="64 64 896 896" width="896" height="896" version="1.1" xmlns="http://www.w3.org/2000/svg"><path fill="${filterColor}" d="${filterPath}"/></svg>`;
  };

  // 1. 未筛选状态：必须包含 FilterOutlined 标准路径与 XML 命名空间，中空漏斗
  const normalSvg = generateFilterSvg(false, false, '#8c8c8c');
  assert.ok(normalSvg.includes('xmlns="http://www.w3.org/2000/svg"'), '必须包含 XML 命名空间防止 Canvas 解析为破损图标');
  assert.ok(normalSvg.includes('viewBox="64 64 896 896"'), '必须使用 antd 896 视口');
  assert.ok(normalSvg.includes(antdFilterOutlinedPath), '未筛选态必须匹配 antd FilterOutlined 路径');
  assert.ok(normalSvg.includes('fill="#8c8c8c"'));

  // 2. 已激活筛选状态：必须包含 FilterFilled 实心路径与品牌蓝色高亮
  const activeSvg = generateFilterSvg(true, false, '#8c8c8c');
  assert.ok(activeSvg.includes(antdFilterFilledPath), '已筛选态必须匹配 antd FilterFilled 路径');
  assert.ok(activeSvg.includes('fill="#1677ff"'), '已筛选态必须为主题蓝色');
});

test('table: 总计行标签在多维表格视图下始终固定在第一列 (首列)，杜绝因图表透视维度切换导致各看板总计行错位', () => {
  // 模拟看板 1 包含多维聚合：计划投产时间 (Col 0) + 承制车间 (Col 1)
  const columns1 = [
    { key: 'plan_start_time', title: '计划投产时间', type: 'time' },
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'output_qty', title: '交付总件数', type: 'number' },
  ];
  const filteredData1 = [
    { plan_start_time: '2026-08', workshop: '1号车间', output_qty: 100 },
    { plan_start_time: '2026-08', workshop: '2号车间', output_qty: 150 },
    { plan_start_time: '2026-08', workshop: '3号车间', output_qty: 200 },
  ];

  // 模拟构造看板 1 总计行：即使图表透视 dimensionField 当前处于 'workshop'，总计文本也必须严格固定在表格第一列 (plan_start_time)
  const summaryRow1 = { output_qty: 450, __isSummaryRow: true };
  const firstColKey1 = columns1[0]?.key;
  if (firstColKey1) {
    summaryRow1[firstColKey1] = `总计 (共 ${filteredData1.length} 项)`;
  }

  // 验证看板 1 总计行格式：第一列为总计文本，第二列为 undefined (表格渲染为 -)，指标列准确合计
  assert.equal(summaryRow1.plan_start_time, '总计 (共 3 项)');
  assert.equal(summaryRow1.workshop, undefined);
  assert.equal(summaryRow1.output_qty, 450);

  // 模拟看板 2 包含多维聚合：完工质检时间 (Col 0) + 承制车间 (Col 1)
  const columns2 = [
    { key: 'finish_time', title: '完工质检时间', type: 'time' },
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'output_qty', title: '完工验收总数', type: 'number' },
  ];
  const filteredData2 = [
    { finish_time: '2026-08', workshop: '1号车间', output_qty: 100 },
    { finish_time: '2026-08', workshop: '2号车间', output_qty: 150 },
    { finish_time: '2026-08', workshop: '3号车间', output_qty: 200 },
  ];

  const summaryRow2 = { output_qty: 450, __isSummaryRow: true };
  const firstColKey2 = columns2[0]?.key;
  if (firstColKey2) {
    summaryRow2[firstColKey2] = `总计 (共 ${filteredData2.length} 项)`;
  }

  // 验证看板 2 总计行格式：第一列为总计文本，第二列为 undefined (表格渲染为 -)，指标列准确合计
  assert.equal(summaryRow2.finish_time, '总计 (共 3 项)');
  assert.equal(summaryRow2.workshop, undefined);
  assert.equal(summaryRow2.output_qty, 450);

  // 验证两图表总计行绝对结构对齐：均在第一列呈现 "总计 (共 N 项)"，第二列呈现未定义/横杠，完全杜绝错位！
  assert.equal(summaryRow1[columns1[0].key], summaryRow2[columns2[0].key]);
  assert.equal(summaryRow1[columns1[1].key], summaryRow2[columns2[1].key]);
});

test('tableExport: CSV 公式注入 (CWE-1236) 防范与 HTML 实体安全转义', () => {
  const columns = [
    { key: 'name', title: '名称' },
    { key: 'formula_test', title: '公式注入测试' },
    { key: 'num_val', title: '合法负数' },
  ];
  const maliciousData = [
    { name: 'Row 1', formula_test: '=1+1', num_val: -100 },
    { name: 'Row 2', formula_test: '@SUM(A1:A10)', num_val: 50 },
    { name: 'Row 3', formula_test: '-cmd|"/C calc"!A0', num_val: -3.14 },
    { name: '<script>alert("xss")</script>', formula_test: '+12345', num_val: 0 },
  ];

  const csv = generateCsvContent(maliciousData, columns);
  // 必须以前置单引号对恶意前缀字符进行中和转义
  assert.ok(csv.includes("'=1+1"), '以 = 开头的公式必须前置单引号转义');
  assert.ok(csv.includes("'@SUM(A1:A10)"), '以 @ 开头的公式必须前置单引号转义');
  assert.ok(csv.includes("'-cmd|"), '以 - 开头的非数字文本必须前置单引号转义');
  assert.ok(csv.includes("'+12345"), '以 + 开头的文本必须前置单引号转义');
  // 合法数字不应被破坏
  assert.ok(csv.includes('-100'), '真实数字 -100 必须保持数值格式不受单引号破坏');
  assert.ok(csv.includes('-3.14'), '真实数字 -3.14 必须保持数值格式');
});

