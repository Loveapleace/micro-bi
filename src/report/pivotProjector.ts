/**
 * 双向交叉透视表投影器 (pivotProjector.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 将扁平事实数据与双轴维度投影为 BiGridModel：
 * 1. 支持指标横向展开 (indicatorsAsCol: true)
 * 2. 支持指标纵向展开 (indicatorsAsCol: false)
 * 3. 严格从底层叶子桶汇总计算右侧总计 (rightTotals)、底部总计 (bottomTotals) 与角落总计
 * 4. 支持行/列轴层级小计 (showSubTotals)
 * 5. 杜绝二次平均与错误累加
 * 6. 生成结构化的表头合并 (merges) 与语义绑定 (ReportBinding)
 */
import type { DataRecord } from '../engine/types.js';
import type {
  BiGridModel,
  BiGridCell,
  ReportCellMerge,
  ReportBinding,
  AxisMemberRef,
} from './types.js';
import type { NormalizedAxes, NormalizedDimension } from './normalizeAxes.js';
import { formatTimeBucket } from '../engine/bucketing.js';
import { createReportBinding, serializeAxisPath } from './bindings.js';
import { evaluateMetricsForBucket } from './calculateMetrics.js';

interface MemberPathItem {
  path: AxisMemberRef[];
  key: string; // 纯数据匹配键：serializeAxisPath(currentPath)
  isSubtotal: boolean;
  subtotalDepth?: number | undefined;
  subtotalLabel?: string | undefined;
}

interface GroupNode {
  dim: NormalizedDimension;
  memberKey: string;
  label: string;
  ref: AxisMemberRef;
  children?: Map<string, GroupNode> | undefined;
}

function extractMemberPaths(
  records: readonly DataRecord[],
  dims: readonly NormalizedDimension[],
  showSubTotals: boolean,
  subTotalLabel: string = '小计',
  sorts?: readonly { field: string; order?: 'asc' | 'desc' }[] | undefined
): MemberPathItem[] {
  if (dims.length === 0) {
    return [
      {
        path: [{ axisId: 'root', field: '__root__', memberKey: '__all__', label: '全部' }],
        key: 'ROOT',
        isSubtotal: false,
      },
    ];
  }

  // 1. 构建多级分组树
  const rootGroups = new Map<string, GroupNode>();

  for (const record of records) {
    let currentMap = rootGroups;
    for (let d = 0; d < dims.length; d++) {
      const dim = dims[d]!;
      const rawVal = record[dim.field];
      let memberKey = '';
      if (dim.isTime && dim.timeConfig) {
        memberKey = formatTimeBucket(rawVal, dim.timeConfig);
      } else {
        memberKey = rawVal !== null && rawVal !== undefined && rawVal !== '' ? String(rawVal) : '(空白)';
      }
      const label = memberKey;

      let node = currentMap.get(memberKey);
      if (!node) {
        node = {
          dim,
          memberKey,
          label,
          ref: {
            axisId: dim.id,
            field: dim.field,
            memberKey,
            label,
          },
          children: d < dims.length - 1 ? new Map<string, GroupNode>() : undefined,
        };
        currentMap.set(memberKey, node);
      }

      if (node.children) {
        currentMap = node.children;
      }
    }
  }

  // 2. 深度遍历分组树，生成叶子节点与层级小计节点
  const list: MemberPathItem[] = [];

  function walk(
    nodes: Map<string, GroupNode>,
    depth: number,
    ancestorRefs: AxisMemberRef[]
  ) {
    const currentDim = dims[depth];
    const sortDef = currentDim ? sorts?.find((s) => s.field === currentDim.field) : undefined;
    const isDesc = sortDef?.order === 'desc';

    const sortedKeys = Array.from(nodes.keys()).sort((a, b) => {
      const comp = a.localeCompare(b);
      return isDesc ? -comp : comp;
    });

    for (const key of sortedKeys) {
      const node = nodes.get(key)!;
      const currentRef = node.ref;
      const currentPath = [...ancestorRefs, currentRef];

      if (node.children && node.children.size > 0) {
        // 先递归展开子成员
        walk(node.children, depth + 1, currentPath);

        // 如果开启了本轴小计，追加该父级的小计成员
        if (showSubTotals) {
          const subtotalPath: AxisMemberRef[] = [...currentPath];
          const nextDim = dims[depth + 1]!;
          subtotalPath.push({
            axisId: `subtotal_${nextDim.id}`,
            field: nextDim.field,
            memberKey: '__subtotal__',
            label: subTotalLabel,
          });
          for (let fill = depth + 2; fill < dims.length; fill++) {
            const fDim = dims[fill]!;
            subtotalPath.push({
              axisId: `subtotal_${fDim.id}`,
              field: fDim.field,
              memberKey: '__subtotal__',
              label: '',
            });
          }

          list.push({
            path: subtotalPath,
            key: serializeAxisPath(currentPath),
            isSubtotal: true,
            subtotalDepth: depth,
            subtotalLabel: subTotalLabel,
          });
        }
      } else {
        // 叶子成员
        list.push({
          path: currentPath,
          key: serializeAxisPath(currentPath),
          isSubtotal: false,
        });
      }
    }
  }

  walk(rootGroups, 0, []);
  return list;
}

export function projectPivotReport(
  records: readonly DataRecord[],
  axes: NormalizedAxes,
  options: {
    analysisId?: string | undefined;
    sheetId?: string | undefined;
  } = {}
): BiGridModel {
  const analysisId = options.analysisId || 'analysis-pivot';
  const sheetId = options.sheetId || 'sheet-1';

  const cells: BiGridCell[] = [];
  const merges: ReportCellMerge[] = [];
  const bindings: ReportBinding[] = [];

  const rowDims = axes.rowAxes;
  const colDims = axes.colAxes;
  const metrics = axes.metrics;
  const indicatorsAsCol = axes.indicatorsAsCol;

  // 1. 提取行列成员路径（结合各轴 subtotal 开关）
  const rowMembers = extractMemberPaths(
    records,
    rowDims,
    Boolean(axes.rowTotals.showSubTotals),
    axes.rowTotals.subTotalLabel || '小计',
    axes.options?.sort
  );
  const colMembers = extractMemberPaths(
    records,
    colDims,
    Boolean(axes.colTotals.showSubTotals),
    axes.colTotals.subTotalLabel || '小计',
    axes.options?.sort
  );

  // 2. 建立桶数据索引（全前缀索引，使叶子与小计均可 O(1) 检索且键结构无歧义）
  const intersectionBuckets = new Map<string, DataRecord[]>();
  const rowBuckets = new Map<string, DataRecord[]>();
  const colBuckets = new Map<string, DataRecord[]>();

  for (const record of records) {
    // 解析行路径全前缀
    const rRefs: AxisMemberRef[] = [];
    for (const dim of rowDims) {
      const rawVal = record[dim.field];
      const memberKey = dim.isTime && dim.timeConfig
        ? formatTimeBucket(rawVal, dim.timeConfig)
        : rawVal !== null && rawVal !== undefined && rawVal !== '' ? String(rawVal) : '(空白)';
      rRefs.push({ axisId: dim.id, field: dim.field, memberKey, label: memberKey });
    }

    const rowKeys: string[] = [];
    if (rowDims.length === 0) {
      rowKeys.push('ROOT');
    } else {
      for (let len = 1; len <= rowDims.length; len++) {
        rowKeys.push(serializeAxisPath(rRefs.slice(0, len)));
      }
    }

    for (const rKey of rowKeys) {
      let rList = rowBuckets.get(rKey);
      if (!rList) {
        rList = [];
        rowBuckets.set(rKey, rList);
      }
      rList.push(record);
    }

    // 解析列路径全前缀
    const cRefs: AxisMemberRef[] = [];
    for (const dim of colDims) {
      const rawVal = record[dim.field];
      const memberKey = dim.isTime && dim.timeConfig
        ? formatTimeBucket(rawVal, dim.timeConfig)
        : rawVal !== null && rawVal !== undefined && rawVal !== '' ? String(rawVal) : '(空白)';
      cRefs.push({ axisId: dim.id, field: dim.field, memberKey, label: memberKey });
    }

    const colKeys: string[] = [];
    if (colDims.length === 0) {
      colKeys.push('ROOT');
    } else {
      for (let len = 1; len <= colDims.length; len++) {
        colKeys.push(serializeAxisPath(cRefs.slice(0, len)));
      }
    }

    for (const cKey of colKeys) {
      let cList = colBuckets.get(cKey);
      if (!cList) {
        cList = [];
        colBuckets.set(cKey, cList);
      }
      cList.push(record);
    }

    // 存入所有行列交叉前缀桶 (无歧义 JSON 结构)
    for (const rKey of rowKeys) {
      for (const cKey of colKeys) {
        const intersectKey = JSON.stringify([rKey, cKey]);
        let iList = intersectionBuckets.get(intersectKey);
        if (!iList) {
          iList = [];
          intersectionBuckets.set(intersectKey, iList);
        }
        iList.push(record);
      }
    }
  }

  // 预先计算全局总计指标（全量底层流水）
  const grandTotalMetrics = evaluateMetricsForBucket(records, metrics, axes.rawHeaders);

  // =========================================================================
  // 形态 A：指标横向展开 (indicatorsAsCol === true)
  // =========================================================================
  if (indicatorsAsCol) {
    const headerRowCount = Math.max(colDims.length, 1) + 1; // 列维度层数 + 1层指标名
    const rowDimCount = Math.max(rowDims.length, 1);
    const colGroupSpan = metrics.length; // 每个列成员占用 metrics.length 列

    // 计算总列数
    let dataColCount = colMembers.length * colGroupSpan;
    if (axes.colTotals.showGrandTotals) {
      dataColCount += colGroupSpan; // 右侧总计占用 metrics.length 列
    }
    const totalCols = rowDimCount + dataColCount;

    // A1. 左上角：行维度表头合并
    for (let d = 0; d < rowDimCount; d++) {
      const label = rowDims[d]?.label || '';
      cells.push({
        row: 0,
        col: d,
        value: label,
        displayText: label,
        role: 'dimension-header',
        field: rowDims[d]?.field,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: 0,
          column: d,
          role: 'dimension-header',
          field: rowDims[d]?.field,
        })
      );
      // 垂直合并至表头底端
      if (headerRowCount > 1) {
        merges.push({
          startRow: 0,
          endRow: headerRowCount - 1,
          startCol: d,
          endCol: d,
        });
      }
    }

    // A2. 列维度层级表头 (行 0 ~ colDims.length - 1)
    for (let lvl = 0; lvl < colDims.length; lvl++) {
      let runStartIdx = 0;
      while (runStartIdx < colMembers.length) {
        let runEndIdx = runStartIdx;
        const startMem = colMembers[runStartIdx]!;
        const startKey = serializeAxisPath(startMem.path.slice(0, lvl + 1));

        while (
          runEndIdx + 1 < colMembers.length &&
          serializeAxisPath(colMembers[runEndIdx + 1]!.path.slice(0, lvl + 1)) === startKey
        ) {
          runEndIdx++;
        }

        const startCol = rowDimCount + runStartIdx * colGroupSpan;
        const endCol = rowDimCount + runEndIdx * colGroupSpan + colGroupSpan - 1;
        const ref = startMem.path[lvl];
        const val = ref ? ref.label || ref.memberKey : '';
        const isSubtotalLvl = startMem.isSubtotal && lvl > (startMem.subtotalDepth ?? -1);

        cells.push({
          row: lvl,
          col: startCol,
          value: val,
          displayText: val,
          role: isSubtotalLvl ? 'subtotal' : 'dimension-member',
          columnPath: startMem.path.slice(0, lvl + 1),
          field: ref?.field,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: lvl,
            column: startCol,
            role: isSubtotalLvl ? 'subtotal' : 'dimension-member',
            columnPath: startMem.path.slice(0, lvl + 1),
            field: ref?.field,
          })
        );

        if (endCol > startCol) {
          merges.push({
            startRow: lvl,
            endRow: lvl,
            startCol,
            endCol,
          });
        }

        runStartIdx = runEndIdx + 1;
      }
    }

    // 右侧总计列头
    if (axes.colTotals.showGrandTotals) {
      const grandStartCol = rowDimCount + colMembers.length * colGroupSpan;
      const grandEndCol = grandStartCol + colGroupSpan - 1;
      const grandLabel = axes.colTotals.grandTotalLabel || '总计';

      cells.push({
        row: 0,
        col: grandStartCol,
        value: grandLabel,
        displayText: grandLabel,
        role: 'grand-total',
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: 0,
          column: grandStartCol,
          role: 'grand-total',
        })
      );

      // 合并右侧总计顶层单元格
      if (colGroupSpan > 1 || colDims.length > 1) {
        merges.push({
          startRow: 0,
          endRow: Math.max(colDims.length - 1, 0),
          startCol: grandStartCol,
          endCol: grandEndCol,
        });
      }
    }

    // A3. 表头最底行：平铺指标名称 (row = headerRowCount - 1)
    const metricHeaderRow = headerRowCount - 1;
    // 数据列各指标
    colMembers.forEach((colMem, cIdx) => {
      const baseCol = rowDimCount + cIdx * colGroupSpan;
      const cellRole = colMem.isSubtotal ? 'subtotal' : 'metric-header';
      metrics.forEach((m, mIdx) => {
        const col = baseCol + mIdx;
        cells.push({
          row: metricHeaderRow,
          col,
          value: m.label,
          displayText: m.label,
          role: cellRole,
          columnPath: colMem.path,
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: metricHeaderRow,
            column: col,
            role: cellRole,
            columnPath: colMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      });
    });

    // 右侧总计各指标
    if (axes.colTotals.showGrandTotals) {
      const baseCol = rowDimCount + colMembers.length * colGroupSpan;
      metrics.forEach((m, mIdx) => {
        const col = baseCol + mIdx;
        cells.push({
          row: metricHeaderRow,
          col,
          value: m.label,
          displayText: m.label,
          role: 'metric-header',
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: metricHeaderRow,
            column: col,
            role: 'metric-header',
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      });
    }

    let currentRow = headerRowCount;

    // A4. 渲染各行成员与交叉单元格
    rowMembers.forEach((rowMem) => {
      const rRow = currentRow;

      if (rowMem.isSubtotal) {
        // 先填充祖先维度
        for (let d = 0; d <= (rowMem.subtotalDepth ?? 0); d++) {
          const ref = rowMem.path[d]!;
          cells.push({
            row: rRow,
            col: d,
            value: ref.label || ref.memberKey,
            displayText: ref.label || ref.memberKey,
            role: 'dimension-member',
            rowPath: rowMem.path.slice(0, d + 1),
            field: ref.field,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: rRow,
              column: d,
              role: 'dimension-member',
              rowPath: rowMem.path.slice(0, d + 1),
              field: ref.field,
            })
          );
        }

        // 小计标签填充在当前子级列
        const subCol = (rowMem.subtotalDepth ?? 0) + 1;
        const subLabel = axes.rowTotals.subTotalLabel || '小计';
        const subRef = rowMem.path[subCol];
        cells.push({
          row: rRow,
          col: subCol,
          value: subLabel,
          displayText: subLabel,
          role: 'subtotal',
          rowPath: rowMem.path.slice(0, subCol + 1),
          field: subRef?.field,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: rRow,
            column: subCol,
            role: 'subtotal',
            rowPath: rowMem.path.slice(0, subCol + 1),
            field: subRef?.field,
          })
        );

        // 剩余维度列填充空白
        for (let c = subCol + 1; c < rowDimCount; c++) {
          cells.push({
            row: rRow,
            col: c,
            value: '',
            displayText: '',
            role: 'subtotal',
            rowPath: rowMem.path,
          });
        }

        // 若有多余维度列，横向合并小计单元格
        if (rowDimCount - 1 > subCol) {
          merges.push({
            startRow: rRow,
            endRow: rRow,
            startCol: subCol,
            endCol: rowDimCount - 1,
          });
        }
      } else {
        // 普通叶子行
        rowMem.path.forEach((ref, dIdx) => {
          cells.push({
            row: rRow,
            col: dIdx,
            value: ref.label || ref.memberKey,
            displayText: ref.label || ref.memberKey,
            role: 'dimension-member',
            rowPath: rowMem.path.slice(0, dIdx + 1),
            field: ref.field,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: rRow,
              column: dIdx,
              role: 'dimension-member',
              rowPath: rowMem.path.slice(0, dIdx + 1),
              field: ref.field,
            })
          );
        });
      }

      // 交叉格计算
      colMembers.forEach((colMem, cIdx) => {
        const baseCol = rowDimCount + cIdx * colGroupSpan;
        const intersectKey = JSON.stringify([rowMem.key, colMem.key]);
        const intersectRecords = intersectionBuckets.get(intersectKey) || [];
        const evaluated = evaluateMetricsForBucket(intersectRecords, metrics, axes.rawHeaders);
        const isSubtotalCell = rowMem.isSubtotal || colMem.isSubtotal;
        const cellRole = isSubtotalCell ? 'subtotal' : 'metric-value';

        metrics.forEach((m, mIdx) => {
          const col = baseCol + mIdx;
          const res = evaluated.get(m.id) || { value: null, displayText: '-' };
          cells.push({
            row: rRow,
            col,
            value: res.value,
            displayText: res.displayText,
            role: cellRole,
            rowPath: rowMem.path,
            columnPath: colMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: rRow,
              column: col,
              role: cellRole,
              rowPath: rowMem.path,
              columnPath: colMem.path,
              metricId: m.id,
              field: m.field,
              agg: m.agg,
            })
          );
        });
      });

      // 右侧总计格 (行汇总：直接基于 rowBuckets 对应前缀计算，杜绝相加)
      if (axes.colTotals.showGrandTotals) {
        const baseCol = rowDimCount + colMembers.length * colGroupSpan;
        const rowAllRecords = rowBuckets.get(rowMem.key) || [];
        const evaluatedRow = evaluateMetricsForBucket(rowAllRecords, metrics, axes.rawHeaders);
        const cellRole = rowMem.isSubtotal ? 'subtotal' : 'grand-total';

        metrics.forEach((m, mIdx) => {
          const col = baseCol + mIdx;
          const res = evaluatedRow.get(m.id) || { value: null, displayText: '-' };
          cells.push({
            row: rRow,
            col,
            value: res.value,
            displayText: res.displayText,
            role: cellRole,
            rowPath: rowMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: rRow,
              column: col,
              role: cellRole,
              rowPath: rowMem.path,
              metricId: m.id,
              field: m.field,
              agg: m.agg,
            })
          );
        });
      }

      currentRow += 1;
    });

    // A5. 底部总计行 (rowTotals.showGrandTotals)
    if (axes.rowTotals.showGrandTotals) {
      const bottomRow = currentRow;
      const bottomLabel = axes.rowTotals.grandTotalLabel || '总计';

      cells.push({
        row: bottomRow,
        col: 0,
        value: bottomLabel,
        displayText: bottomLabel,
        role: 'grand-total',
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: bottomRow,
          column: 0,
          role: 'grand-total',
        })
      );

      // 行维度占位清空并合并
      for (let d = 1; d < rowDimCount; d++) {
        cells.push({
          row: bottomRow,
          col: d,
          value: '',
          displayText: '',
          role: 'grand-total',
        });
      }
      if (rowDimCount > 1) {
        merges.push({
          startRow: bottomRow,
          endRow: bottomRow,
          startCol: 0,
          endCol: rowDimCount - 1,
        });
      }

      // 底部各列汇总 (直接基于 colBuckets 对应前缀计算)
      colMembers.forEach((colMem, cIdx) => {
        const baseCol = rowDimCount + cIdx * colGroupSpan;
        const colAllRecords = colBuckets.get(colMem.key) || [];
        const evaluatedCol = evaluateMetricsForBucket(colAllRecords, metrics, axes.rawHeaders);
        const cellRole = colMem.isSubtotal ? 'subtotal' : 'grand-total';

        metrics.forEach((m, mIdx) => {
          const col = baseCol + mIdx;
          const res = evaluatedCol.get(m.id) || { value: null, displayText: '-' };
          cells.push({
            row: bottomRow,
            col,
            value: res.value,
            displayText: res.displayText,
            role: cellRole,
            columnPath: colMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: bottomRow,
              column: col,
              role: cellRole,
              columnPath: colMem.path,
              metricId: m.id,
              field: m.field,
              agg: m.agg,
            })
          );
        });
      });

      // 角落总计 (右下角：全量叶子汇总，杜绝从右侧/底部二次计算)
      if (axes.colTotals.showGrandTotals) {
        const baseCol = rowDimCount + colMembers.length * colGroupSpan;
        metrics.forEach((m, mIdx) => {
          const col = baseCol + mIdx;
          const res = grandTotalMetrics.get(m.id) || { value: null, displayText: '-' };
          cells.push({
            row: bottomRow,
            col,
            value: res.value,
            displayText: res.displayText,
            role: 'grand-total',
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: bottomRow,
              column: col,
              role: 'grand-total',
              metricId: m.id,
              field: m.field,
              agg: m.agg,
            })
          );
        });
      }

      currentRow += 1;
    }

    return {
      type: 'pivot',
      rowCount: currentRow,
      colCount: totalCols,
      cells,
      merges,
      bindings,
    };
  }

  // =========================================================================
  // 形态 B：指标纵向展开 (indicatorsAsCol === false)
  // =========================================================================
  const headerRowCount = Math.max(colDims.length, 1);
  const rowDimCount = Math.max(rowDims.length, 1);
  const metricColIdx = rowDimCount; // 指标列固定在行维度后紧接着的一列

  let dataColCount = colMembers.length;
  if (axes.colTotals.showGrandTotals) {
    dataColCount += 1; // 右侧总计占 1 列
  }
  const totalCols = rowDimCount + 1 + dataColCount;

  // B1. 左上角：行维度表头 + 指标列表头
  for (let d = 0; d < rowDimCount; d++) {
    const label = rowDims[d]?.label || '';
    cells.push({
      row: 0,
      col: d,
      value: label,
      displayText: label,
      role: 'dimension-header',
      field: rowDims[d]?.field,
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: 0,
        column: d,
        role: 'dimension-header',
        field: rowDims[d]?.field,
      })
    );
    if (headerRowCount > 1) {
      merges.push({
        startRow: 0,
        endRow: headerRowCount - 1,
        startCol: d,
        endCol: d,
      });
    }
  }

  // 指标列表头
  cells.push({
    row: 0,
    col: metricColIdx,
    value: '指标',
    displayText: '指标',
    role: 'dimension-header',
  });
  bindings.push(
    createReportBinding({
      analysisId,
      sheetId,
      row: 0,
      column: metricColIdx,
      role: 'dimension-header',
    })
  );
  if (headerRowCount > 1) {
    merges.push({
      startRow: 0,
      endRow: headerRowCount - 1,
      startCol: metricColIdx,
      endCol: metricColIdx,
    });
  }

  // B2. 列维度表头展开 (每个列成员只占 1 列)
  for (let lvl = 0; lvl < colDims.length; lvl++) {
    let runStartIdx = 0;
    while (runStartIdx < colMembers.length) {
      let runEndIdx = runStartIdx;
      const startMem = colMembers[runStartIdx]!;
      const startKey = serializeAxisPath(startMem.path.slice(0, lvl + 1));

      while (
        runEndIdx + 1 < colMembers.length &&
        serializeAxisPath(colMembers[runEndIdx + 1]!.path.slice(0, lvl + 1)) === startKey
      ) {
        runEndIdx++;
      }

      const startCol = metricColIdx + 1 + runStartIdx;
      const endCol = metricColIdx + 1 + runEndIdx;
      const ref = startMem.path[lvl];
      const val = ref ? ref.label || ref.memberKey : '';
      const isSubtotalLvl = startMem.isSubtotal && lvl > (startMem.subtotalDepth ?? -1);

      cells.push({
        row: lvl,
        col: startCol,
        value: val,
        displayText: val,
        role: isSubtotalLvl ? 'subtotal' : 'dimension-member',
        columnPath: startMem.path.slice(0, lvl + 1),
        field: ref?.field,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: lvl,
          column: startCol,
          role: isSubtotalLvl ? 'subtotal' : 'dimension-member',
          columnPath: startMem.path.slice(0, lvl + 1),
          field: ref?.field,
        })
      );

      if (endCol > startCol) {
        merges.push({
          startRow: lvl,
          endRow: lvl,
          startCol,
          endCol,
        });
      }

      runStartIdx = runEndIdx + 1;
    }
  }

  // 右侧总计表头
  if (axes.colTotals.showGrandTotals) {
    const col = metricColIdx + 1 + colMembers.length;
    const grandLabel = axes.colTotals.grandTotalLabel || '总计';
    cells.push({
      row: 0,
      col,
      value: grandLabel,
      displayText: grandLabel,
      role: 'grand-total',
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: 0,
        column: col,
        role: 'grand-total',
      })
    );
    if (headerRowCount > 1) {
      merges.push({
        startRow: 0,
        endRow: headerRowCount - 1,
        startCol: col,
        endCol: col,
      });
    }
  }

  let currentRow = headerRowCount;

  // B3. 数据行：每个行成员占用 metrics.length 行
  rowMembers.forEach((rowMem) => {
    const startRow = currentRow;
    const endRow = startRow + metrics.length - 1;

    if (rowMem.isSubtotal) {
      // 先填充祖先维度
      for (let d = 0; d <= (rowMem.subtotalDepth ?? 0); d++) {
        const ref = rowMem.path[d]!;
        cells.push({
          row: startRow,
          col: d,
          value: ref.label || ref.memberKey,
          displayText: ref.label || ref.memberKey,
          role: 'dimension-member',
          rowPath: rowMem.path.slice(0, d + 1),
          field: ref.field,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: startRow,
            column: d,
            role: 'dimension-member',
            rowPath: rowMem.path.slice(0, d + 1),
            field: ref.field,
          })
        );
        if (metrics.length > 1) {
          merges.push({ startRow, endRow, startCol: d, endCol: d });
        }
      }

      // 小计标签填充在当前子级列
      const subCol = (rowMem.subtotalDepth ?? 0) + 1;
      const subLabel = axes.rowTotals.subTotalLabel || '小计';
      const subRef = rowMem.path[subCol];
      cells.push({
        row: startRow,
        col: subCol,
        value: subLabel,
        displayText: subLabel,
        role: 'subtotal',
        rowPath: rowMem.path.slice(0, subCol + 1),
        field: subRef?.field,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: startRow,
          column: subCol,
          role: 'subtotal',
          rowPath: rowMem.path.slice(0, subCol + 1),
          field: subRef?.field,
        })
      );
      if (metrics.length > 1) {
        merges.push({ startRow, endRow, startCol: subCol, endCol: subCol });
      }

      // 剩余维度列填充空白
      for (let c = subCol + 1; c < rowDimCount; c++) {
        cells.push({
          row: startRow,
          col: c,
          value: '',
          displayText: '',
          role: 'subtotal',
          rowPath: rowMem.path,
        });
        if (metrics.length > 1) {
          merges.push({ startRow, endRow, startCol: c, endCol: c });
        }
      }

      // 若有多余维度列，横向合并
      if (rowDimCount - 1 > subCol) {
        for (let r = startRow; r <= endRow; r++) {
          merges.push({
            startRow: r,
            endRow: r,
            startCol: subCol,
            endCol: rowDimCount - 1,
          });
        }
      }
    } else {
      // 普通叶子行
      rowMem.path.forEach((ref, dIdx) => {
        cells.push({
          row: startRow,
          col: dIdx,
          value: ref.label || ref.memberKey,
          displayText: ref.label || ref.memberKey,
          role: 'dimension-member',
          rowPath: rowMem.path.slice(0, dIdx + 1),
          field: ref.field,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row: startRow,
            column: dIdx,
            role: 'dimension-member',
            rowPath: rowMem.path.slice(0, dIdx + 1),
            field: ref.field,
          })
        );

        if (metrics.length > 1) {
          merges.push({
            startRow,
            endRow,
            startCol: dIdx,
            endCol: dIdx,
          });
        }
      });
    }

    // 预计算本行跨列的各桶值
    const rowAllRecords = rowBuckets.get(rowMem.key) || [];
    const evaluatedRowAll = evaluateMetricsForBucket(rowAllRecords, metrics, axes.rawHeaders);

    const evaluatedCols = colMembers.map((colMem) => {
      const intersectKey = JSON.stringify([rowMem.key, colMem.key]);
      const recordsInIntersect = intersectionBuckets.get(intersectKey) || [];
      return evaluateMetricsForBucket(recordsInIntersect, metrics, axes.rawHeaders);
    });

    // 纵向展开每个指标
    metrics.forEach((m, mIdx) => {
      const row = startRow + mIdx;

      // 指标名称列
      cells.push({
        row,
        col: metricColIdx,
        value: m.label,
        displayText: m.label,
        role: rowMem.isSubtotal ? 'subtotal' : 'metric-header',
        rowPath: rowMem.path,
        metricId: m.id,
        field: m.field,
        agg: m.agg,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row,
          column: metricColIdx,
          role: rowMem.isSubtotal ? 'subtotal' : 'metric-header',
          rowPath: rowMem.path,
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        })
      );

      // 各列交叉格
      colMembers.forEach((colMem, cIdx) => {
        const col = metricColIdx + 1 + cIdx;
        const res = evaluatedCols[cIdx]?.get(m.id) || { value: null, displayText: '-' };
        const cellRole = (rowMem.isSubtotal || colMem.isSubtotal) ? 'subtotal' : 'metric-value';
        cells.push({
          row,
          col,
          value: res.value,
          displayText: res.displayText,
          role: cellRole,
          rowPath: rowMem.path,
          columnPath: colMem.path,
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row,
            column: col,
            role: cellRole,
            rowPath: rowMem.path,
            columnPath: colMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      });

      // 右侧行总计格
      if (axes.colTotals.showGrandTotals) {
        const col = metricColIdx + 1 + colMembers.length;
        const res = evaluatedRowAll.get(m.id) || { value: null, displayText: '-' };
        const cellRole = rowMem.isSubtotal ? 'subtotal' : 'grand-total';
        cells.push({
          row,
          col,
          value: res.value,
          displayText: res.displayText,
          role: cellRole,
          rowPath: rowMem.path,
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row,
            column: col,
            role: cellRole,
            rowPath: rowMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      }
    });

    currentRow += metrics.length;
  });

  // B4. 底部总计行 (rowTotals.showGrandTotals)
  if (axes.rowTotals.showGrandTotals) {
    const startRow = currentRow;
    const endRow = startRow + metrics.length - 1;
    const bottomLabel = axes.rowTotals.grandTotalLabel || '总计';

    // 填充总计标签并垂直合并
    cells.push({
      row: startRow,
      col: 0,
      value: bottomLabel,
      displayText: bottomLabel,
      role: 'grand-total',
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: startRow,
        column: 0,
        role: 'grand-total',
      })
    );

    // 维度其他列占位
    for (let d = 1; d < rowDimCount; d++) {
      cells.push({
        row: startRow,
        col: d,
        value: '',
        displayText: '',
        role: 'grand-total',
      });
    }

    if (metrics.length > 1 || rowDimCount > 1) {
      merges.push({
        startRow,
        endRow,
        startCol: 0,
        endCol: rowDimCount - 1,
      });
    }

    // 预计算底部各列汇总
    const evaluatedBottomCols = colMembers.map((colMem) => {
      const recordsInCol = colBuckets.get(colMem.key) || [];
      return evaluateMetricsForBucket(recordsInCol, metrics, axes.rawHeaders);
    });

    // 纵向展开每个指标的总计行
    metrics.forEach((m, mIdx) => {
      const row = startRow + mIdx;

      // 指标名称列
      cells.push({
        row,
        col: metricColIdx,
        value: m.label,
        displayText: m.label,
        role: 'metric-header',
        metricId: m.id,
        field: m.field,
        agg: m.agg,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row,
          column: metricColIdx,
          role: 'metric-header',
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        })
      );

      // 各列底部汇总格
      colMembers.forEach((colMem, cIdx) => {
        const col = metricColIdx + 1 + cIdx;
        const res = evaluatedBottomCols[cIdx]?.get(m.id) || { value: null, displayText: '-' };
        const cellRole = colMem.isSubtotal ? 'subtotal' : 'grand-total';
        cells.push({
          row,
          col,
          value: res.value,
          displayText: res.displayText,
          role: cellRole,
          columnPath: colMem.path,
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row,
            column: col,
            role: cellRole,
            columnPath: colMem.path,
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      });

      // 角落总计格 (全表叶子汇总)
      if (axes.colTotals.showGrandTotals) {
        const col = metricColIdx + 1 + colMembers.length;
        const res = grandTotalMetrics.get(m.id) || { value: null, displayText: '-' };
        cells.push({
          row,
          col,
          value: res.value,
          displayText: res.displayText,
          role: 'grand-total',
          metricId: m.id,
          field: m.field,
          agg: m.agg,
        });
        bindings.push(
          createReportBinding({
            analysisId,
            sheetId,
            row,
            column: col,
            role: 'grand-total',
            metricId: m.id,
            field: m.field,
            agg: m.agg,
          })
        );
      }
    });

    currentRow += metrics.length;
  }

  return {
    type: 'pivot',
    rowCount: currentRow,
    colCount: totalCols,
    cells,
    merges,
    bindings,
  };
}
