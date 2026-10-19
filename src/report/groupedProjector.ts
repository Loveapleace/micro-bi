/**
 * 分组报表投影器 (groupedProjector.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 将扁平事实数据与分组维度投影为 BiGridModel：
 * 1. 结构化表头（维度头 + 指标头）
 * 2. 多级行维度层级展开
 * 3. 严格受父级边界保护的层级单元格合并 (Parent-level hierarchical merge)
 * 4. 组级小计（基于底层切片重新计算，杜绝算术二次平均）
 * 5. 全局总计（加权平均、非空计数、公式重新求值）
 * 6. 生成全局一致的语义绑定 (ReportBinding)
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
import { createReportBinding } from './bindings.js';
import { evaluateMetricsForBucket, enhanceRecordsWithRowComputed } from './calculateMetrics.js';

interface GroupNode {
  dimension: NormalizedDimension;
  memberKey: string;
  label: string;
  records: DataRecord[];
  children?: Map<string, GroupNode> | undefined;
}

export function projectGroupedReport(
  records: readonly DataRecord[],
  axes: NormalizedAxes,
  options: {
    analysisId?: string | undefined;
    sheetId?: string | undefined;
  } = {}
): BiGridModel {
  const analysisId = options.analysisId || 'analysis-grouped';
  const sheetId = options.sheetId || 'sheet-1';

  const cells: BiGridCell[] = [];
  const merges: ReportCellMerge[] = [];
  const bindings: ReportBinding[] = [];

  const rowDims = axes.rowAxes;
  const metrics = axes.metrics;
  const totalCols = rowDims.length + metrics.length;

  let currentRow = 0;

  // 1. 生成表头 (Row 0)
  // 维度表头
  rowDims.forEach((dim, colIdx) => {
    cells.push({
      row: currentRow,
      col: colIdx,
      value: dim.label,
      displayText: dim.label,
      role: 'dimension-header',
      field: dim.field,
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: currentRow,
        column: colIdx,
        role: 'dimension-header',
        field: dim.field,
      })
    );
  });

  // 指标表头
  metrics.forEach((metric, mIdx) => {
    const colIdx = rowDims.length + mIdx;
    cells.push({
      row: currentRow,
      col: colIdx,
      value: metric.label,
      displayText: metric.label,
      role: 'metric-header',
      metricId: metric.id,
      field: metric.field,
      agg: metric.agg,
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: currentRow,
        column: colIdx,
        role: 'metric-header',
        metricId: metric.id,
        field: metric.field,
        agg: metric.agg,
      })
    );
  });

  currentRow += 1;

  // 2. 若没有任何行维度：
  // 遵循引擎的三态仲裁：若为 detail 明细模式，投影全部原始事实行；若为 summary 模式，输出单行全局汇总 (MBI-07)
  if (rowDims.length === 0) {
    if (axes.executionForm === 'detail') {
      let enhancedRecords = enhanceRecordsWithRowComputed(records, metrics, axes.rawHeaders);

      // RT-05 / RX-05: 明细模式消费 options.sort
      if (axes.options?.sort && axes.options.sort.length > 0) {
        const sorts = axes.options.sort;
        enhancedRecords = [...enhancedRecords].sort((a, b) => {
          for (const s of sorts) {
            const valA = (a as any)[s.field];
            const valB = (b as any)[s.field];
            if (valA === valB) continue;
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            const comp = valA > valB ? 1 : -1;
            return s.order === 'desc' ? -comp : comp;
          }
          return 0;
        });
      }

      for (let rIdx = 0; rIdx < enhancedRecords.length; rIdx++) {
        const rowRecord = enhancedRecords[rIdx]!;
        const rowNum = currentRow + rIdx;

        // RT-06 / RX-07 / RX-08: 识别业务主键字段并带类型编码
        let pkField = '__row__';
        let pkValue: any = undefined;

        const candidateKeys = ['id', '_id', 'key', 'uuid', 'pk'];
        for (const k of candidateKeys) {
          if ((rowRecord as any)[k] !== undefined && (rowRecord as any)[k] !== null) {
            pkField = k;
            pkValue = (rowRecord as any)[k];
            break;
          }
        }
        if (pkValue === undefined) {
          for (const k of Object.keys(rowRecord)) {
            if (k.endsWith('_code') || k.endsWith('_id') || k.endsWith('_no') || k.endsWith('Code') || k.endsWith('Id')) {
              if ((rowRecord as any)[k] !== undefined && (rowRecord as any)[k] !== null) {
                pkField = k;
                pkValue = (rowRecord as any)[k];
                break;
              }
            }
          }
        }
        if (pkValue === undefined) {
          for (const m of metrics) {
            if (m.kind === 'fixed' && m.field && (rowRecord as any)[m.field] !== undefined && (rowRecord as any)[m.field] !== null) {
              pkField = m.field;
              pkValue = (rowRecord as any)[m.field];
              break;
            }
          }
        }

        const pkMemberKey = pkValue !== undefined && pkValue !== null ? `${typeof pkValue}:${pkValue}` : String(rIdx);

        metrics.forEach((metric, mIdx) => {
          let val: any = null;
          let displayText = '';

          if (metric.kind === 'fixed' || metric.kind === 'aggregated') {
            const field = metric.field || '';
            val = rowRecord[field] ?? null;
            displayText = val !== null && val !== undefined ? String(val) : '';
          } else if (metric.kind === 'computed') {
            val = rowRecord[metric.id] ?? rowRecord[metric.label] ?? null;
            displayText = val !== null && val !== undefined ? String(val) : '';
            if (typeof val === 'number' && metric.precision !== undefined) {
              displayText = val.toFixed(metric.precision);
            }
          }

          cells.push({
            row: rowNum,
            col: mIdx,
            value: val,
            displayText,
            role: 'dimension-member',
            metricId: metric.id,
            field: metric.field,
            agg: metric.agg,
          });

          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: rowNum,
              column: mIdx,
              role: 'dimension-member',
              rowPath: [{ axisId: 'detail', field: pkField, memberKey: pkMemberKey }],
              metricId: metric.id || metric.field,
              field: metric.field,
              agg: metric.agg,
            })
          );
        });
      }

      return {
        type: 'grouped',
        rowCount: currentRow + enhancedRecords.length,
        colCount: Math.max(totalCols, 1),
        cells,
        merges,
        bindings,
      };
    }

    // 纯 summary 汇总模式 (只有纯聚合度量且无维度)
    if (records.length === 0) {
      return {
        type: 'grouped',
        rowCount: currentRow,
        colCount: Math.max(totalCols, 1),
        cells,
        merges,
        bindings,
      };
    }

    const metricResults = evaluateMetricsForBucket(records, metrics, axes.rawHeaders);
    metrics.forEach((metric, mIdx) => {
      const res = metricResults.get(metric.id) || { value: null, displayText: '-' };
      cells.push({
        row: currentRow,
        col: mIdx,
        value: res.value,
        displayText: res.displayText,
        role: 'grand-total',
        metricId: metric.id,
        field: metric.field,
        agg: metric.agg,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: currentRow,
          column: mIdx,
          role: 'grand-total',
          metricId: metric.id,
          field: metric.field,
          agg: metric.agg,
        })
      );
    });

    return {
      type: 'grouped',
      rowCount: currentRow + 1,
      colCount: Math.max(totalCols, 1),
      cells,
      merges,
      bindings,
    };
  }

  // 3. 构建多级分组树
  const rootGroups = new Map<string, GroupNode>();

  for (const record of records) {
    let currentLevelMap = rootGroups;
    for (let d = 0; d < rowDims.length; d++) {
      const dim = rowDims[d]!;
      let rawVal = record[dim.field];
      let memberKey = '';
      let label = '';

      if (dim.isTime && dim.timeConfig) {
        memberKey = formatTimeBucket(rawVal, dim.timeConfig);
        label = memberKey;
      } else {
        memberKey = rawVal !== null && rawVal !== undefined && rawVal !== '' ? String(rawVal) : '(空白)';
        label = memberKey;
      }

      let node = currentLevelMap.get(memberKey);
      if (!node) {
        node = {
          dimension: dim,
          memberKey,
          label,
          records: [],
          children: d < rowDims.length - 1 ? new Map<string, GroupNode>() : undefined,
        };
        currentLevelMap.set(memberKey, node);
      }
      node.records.push(record);

      if (node.children) {
        currentLevelMap = node.children;
      }
    }
  }

  // 4. 递归展开树并生成行、小计与父级保护合并
  function renderGroupNodes(
    nodes: Map<string, GroupNode>,
    depth: number,
    ancestorPath: AxisMemberRef[]
  ) {
    const nodeList = Array.from(nodes.values());
    const sortRules = axes.options?.sort;

    if (sortRules && sortRules.length > 0) {
      // 预先为每个 node 计算指标汇总缓存，以便按指标排序
      const nodeMetricCache = new Map<GroupNode, Map<string, any>>();
      for (const node of nodeList) {
        nodeMetricCache.set(
          node,
          evaluateMetricsForBucket(node.records, metrics, axes.rawHeaders)
        );
      }

      nodeList.sort((nodeA, nodeB) => {
        for (const rule of sortRules) {
          const field = rule.field;
          const order = rule.order || 'asc';
          let valA: any = undefined;
          let valB: any = undefined;

          // 1. 判断是否是当前维度字段
          if (nodeA.dimension.field === field || nodeA.dimension.id === field) {
            valA = nodeA.memberKey;
            valB = nodeB.memberKey;
          } else {
            // 2. 判断是否是指标字段 (如 'SUM(qty)', 'qty', metric.id, metric.label)
            const metricsA = nodeMetricCache.get(nodeA);
            const metricsB = nodeMetricCache.get(nodeB);

            const targetMetric = metrics.find(
              (m) =>
                m.id === field ||
                m.label === field ||
                m.field === field ||
                `${m.agg || 'SUM'}(${m.field})` === field ||
                `${(m.agg || 'SUM').toUpperCase()}(${m.field})` === field
            );

            if (targetMetric) {
              valA = metricsA?.get(targetMetric.id)?.value;
              valB = metricsB?.get(targetMetric.id)?.value;
            }
          }

          if (valA !== valB) {
            if (valA === null || valA === undefined) return order === 'desc' ? 1 : -1;
            if (valB === null || valB === undefined) return order === 'desc' ? -1 : 1;
            if (typeof valA === 'number' && typeof valB === 'number') {
              return order === 'desc' ? valB - valA : valA - valB;
            }
            const cmp = String(valA).localeCompare(String(valB));
            return order === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    for (const node of nodeList) {
      const currentRef: AxisMemberRef = {
        axisId: node.dimension.id,
        field: node.dimension.field,
        memberKey: node.memberKey,
        label: node.label,
      };
      const currentPath = [...ancestorPath, currentRef];
      const startRowForNode = currentRow;

      if (node.children && node.children.size > 0) {
        // 非叶子节点：递归子节点
        renderGroupNodes(node.children, depth + 1, currentPath);

        // 如果开启了小计展示
        if (axes.rowTotals.showSubTotals) {
          const subtotalRow = currentRow;
          // 小计标签填充在当前层级的列
          cells.push({
            row: subtotalRow,
            col: depth,
            value: `${node.label} ${axes.rowTotals.subTotalLabel || '小计'}`,
            displayText: `${node.label} ${axes.rowTotals.subTotalLabel || '小计'}`,
            role: 'subtotal',
            rowPath: currentPath,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: subtotalRow,
              column: depth,
              role: 'subtotal',
              rowPath: currentPath,
            })
          );

          // 填充空白维度格
          for (let c = depth + 1; c < rowDims.length; c++) {
            cells.push({
              row: subtotalRow,
              col: c,
              value: '',
              displayText: '',
              role: 'subtotal',
              rowPath: currentPath,
            });
          }

          // 计算该节点的子集指标
          const subtotalMetrics = evaluateMetricsForBucket(
            node.records,
            metrics,
            axes.rawHeaders
          );

          metrics.forEach((metric, mIdx) => {
            const colIdx = rowDims.length + mIdx;
            const res = subtotalMetrics.get(metric.id) || {
              value: null,
              displayText: '-',
            };
            cells.push({
              row: subtotalRow,
              col: colIdx,
              value: res.value,
              displayText: res.displayText,
              role: 'subtotal',
              rowPath: currentPath,
              metricId: metric.id,
              field: metric.field,
              agg: metric.agg,
            });
            bindings.push(
              createReportBinding({
                analysisId,
                sheetId,
                row: subtotalRow,
                column: colIdx,
                role: 'subtotal',
                rowPath: currentPath,
                metricId: metric.id,
                field: metric.field,
                agg: metric.agg,
              })
            );
          });

          currentRow += 1;
        }

        // 父级受保护合并：将本父节点占用的行范围在列 depth 上合并
        // 注意：合并范围不跨出本父级！
        // 若有小计，叶子范围从 startRowForNode 到 (showSubTotals ? currentRow - 2 : currentRow - 1)
        const mergeEndRow = axes.rowTotals.showSubTotals ? currentRow - 2 : currentRow - 1;
        if (mergeEndRow > startRowForNode) {
          merges.push({
            startRow: startRowForNode,
            endRow: mergeEndRow,
            startCol: depth,
            endCol: depth,
          });
        }
      } else {
        // 叶子节点：输出一行明细数据
        const leafRow = currentRow;

        // 填充维度成员列
        currentPath.forEach((ref, dIdx) => {
          cells.push({
            row: leafRow,
            col: dIdx,
            value: ref.label || ref.memberKey,
            displayText: ref.label || ref.memberKey,
            role: 'dimension-member',
            rowPath: currentPath.slice(0, dIdx + 1),
            field: ref.field,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: leafRow,
              column: dIdx,
              role: 'dimension-member',
              rowPath: currentPath.slice(0, dIdx + 1),
              field: ref.field,
            })
          );
        });

        // 计算叶子度量值
        const leafMetrics = evaluateMetricsForBucket(
          node.records,
          metrics,
          axes.rawHeaders
        );

        metrics.forEach((metric, mIdx) => {
          const colIdx = rowDims.length + mIdx;
          const res = leafMetrics.get(metric.id) || {
            value: null,
            displayText: '-',
          };
          cells.push({
            row: leafRow,
            col: colIdx,
            value: res.value,
            displayText: res.displayText,
            role: 'metric-value',
            rowPath: currentPath,
            metricId: metric.id,
            field: metric.field,
            agg: metric.agg,
          });
          bindings.push(
            createReportBinding({
              analysisId,
              sheetId,
              row: leafRow,
              column: colIdx,
              role: 'metric-value',
              rowPath: currentPath,
              metricId: metric.id,
              field: metric.field,
              agg: metric.agg,
            })
          );
        });

        currentRow += 1;
      }
    }
  }

  renderGroupNodes(rootGroups, 0, []);

  // 5. 全局总计行 (bottomTotals)
  if (axes.rowTotals.showGrandTotals) {
    const grandRow = currentRow;
    const grandLabel = axes.rowTotals.grandTotalLabel || '总计';

    // 维度首列写入总计
    cells.push({
      row: grandRow,
      col: 0,
      value: grandLabel,
      displayText: grandLabel,
      role: 'grand-total',
    });
    bindings.push(
      createReportBinding({
        analysisId,
        sheetId,
        row: grandRow,
        column: 0,
        role: 'grand-total',
      })
    );

    // 其余维度列清空
    for (let c = 1; c < rowDims.length; c++) {
      cells.push({
        row: grandRow,
        col: c,
        value: '',
        displayText: '',
        role: 'grand-total',
      });
    }

    // 若有多列维度，将维度列在总计行合并 (0 ~ rowDims.length - 1)
    if (rowDims.length > 1) {
      merges.push({
        startRow: grandRow,
        endRow: grandRow,
        startCol: 0,
        endCol: rowDims.length - 1,
      });
    }

    // 全量记录聚合计算
    const grandMetrics = evaluateMetricsForBucket(records, metrics, axes.rawHeaders);

    metrics.forEach((metric, mIdx) => {
      const colIdx = rowDims.length + mIdx;
      const res = grandMetrics.get(metric.id) || {
        value: null,
        displayText: '-',
      };
      cells.push({
        row: grandRow,
        col: colIdx,
        value: res.value,
        displayText: res.displayText,
        role: 'grand-total',
        metricId: metric.id,
        field: metric.field,
        agg: metric.agg,
      });
      bindings.push(
        createReportBinding({
          analysisId,
          sheetId,
          row: grandRow,
          column: colIdx,
          role: 'grand-total',
          metricId: metric.id,
          field: metric.field,
          agg: metric.agg,
        })
      );
    });

    currentRow += 1;
  }

  return {
    type: 'grouped',
    rowCount: currentRow,
    colCount: totalCols,
    cells,
    merges,
    bindings,
  };
}
