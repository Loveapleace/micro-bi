import React from 'react';
import { Card, Tag, Space, Typography, Badge, Radio } from 'antd';
import { TableOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TransformResult, DynamicTransformConfig, DataRecord, OutputColumnMeta } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface LivePreviewTableProps {
  readonly result?: TransformResult;
  readonly loading?: boolean;
  readonly config?: DynamicTransformConfig;
}

interface DimTuple {
  key: string;
  label: string;
  values: Record<string, unknown>;
}

/**
 * 格式化单元格数值
 */
function formatValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) {
    return <Text type="secondary">-</Text>;
  }
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? val.toLocaleString()
      : val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(val);
}

/**
 * 实时试算预览表格
 *
 * 采用原生 HTML5 高性能表格与轻量 CSS，彻底剥离 antd/Table 与 rc-table / rc-pagination，
 * 消除数百 KB 冗余体积与虚拟列表初始化负担，前 10 行预览纳秒级直出。
 * 支持双向多维交叉透视表 (Cross-Tab Pivot) 2D 复合矩阵与 1D 扁平交集数据无缝双视图切换。
 */
export const LivePreviewTable: React.FC<LivePreviewTableProps> = ({
  result,
  loading = false,
  config,
}) => {
  const t = useDynamicDataLocale();
  const data = result?.data ?? [];
  const columnsMeta = result?.columns ?? [];
  const meta = result?.meta;
  const isCrossTab = Boolean(meta?.isCrossTab);

  const [viewMode, setViewMode] = React.useState<'grid' | 'flat'>('grid');

  // 当非透视表时，自动同步为 flat 视图
  React.useEffect(() => {
    if (!isCrossTab) {
      setViewMode('flat');
    } else {
      setViewMode('grid');
    }
  }, [isCrossTab]);

  // =========================================================================
  // 提取 2D 交叉透视矩阵结构
  // =========================================================================
  const pivotData = React.useMemo(() => {
    if (!isCrossTab || data.length === 0) return null;

    const rowDimFields: string[] = [
      ...(config?.dimensions?.timeBucket?.field ? [config.dimensions.timeBucket.field] : []),
      ...(config?.dimensions?.categories ?? []),
    ];

    const colDimFields: string[] = [
      ...(config?.dimensions?.columnTimeBucket?.field ? [config.dimensions.columnTimeBucket.field] : []),
      ...(config?.dimensions?.columnCategories ?? []),
    ];

    if (colDimFields.length === 0) return null;

    const metrics: OutputColumnMeta[] = columnsMeta.filter(
      (col) => !rowDimFields.includes(col.field || col.key) && !colDimFields.includes(col.field || col.key)
    );

    if (metrics.length === 0) return null;

    const rowTuples: DimTuple[] = [];
    const rowKeySet = new Set<string>();
    const colTuples: DimTuple[] = [];
    const colKeySet = new Set<string>();
    const cellMap = new Map<string, DataRecord>();

    for (const r of data) {
      const rKey = rowDimFields.map((f) => String(r[f] ?? '')).join('__');
      if (!rowKeySet.has(rKey)) {
        rowKeySet.add(rKey);
        const rVals: Record<string, unknown> = {};
        for (const f of rowDimFields) rVals[f] = r[f];
        rowTuples.push({
          key: rKey,
          label: rowDimFields.map((f) => String(r[f] ?? '')).join(' / ') || '-',
          values: rVals,
        });
      }

      const cKey = colDimFields.map((f) => String(r[f] ?? '')).join('__');
      if (!colKeySet.has(cKey)) {
        colKeySet.add(cKey);
        const cVals: Record<string, unknown> = {};
        for (const f of colDimFields) cVals[f] = r[f];
        colTuples.push({
          key: cKey,
          label: colDimFields.map((f) => String(r[f] ?? '')).join(' / ') || '-',
          values: cVals,
        });
      }

      cellMap.set(`${rKey}____${cKey}`, r);
    }

    const indicatorsAsCol = config?.dimensions?.indicatorsAsCol !== false;
    const showRowTotals = config?.dimensions?.rowTotals?.showGrandTotals !== false;
    const rowTotalsLabel = config?.dimensions?.rowTotals?.grandTotalLabel || t('行总计');
    const showColTotals = config?.dimensions?.columnTotals?.showGrandTotals !== false;
    const colTotalsLabel = config?.dimensions?.columnTotals?.grandTotalLabel || t('列总计');

    // 计算汇总
    const rowMetricSums = new Map<string, number>();
    const colMetricSums = new Map<string, number>();
    const grandMetricSums = new Map<string, number>();

    for (const m of metrics) {
      let gSum = 0;
      for (const r of rowTuples) {
        let rSum = 0;
        for (const c of colTuples) {
          const rec = cellMap.get(`${r.key}____${c.key}`);
          const val = rec ? (rec[m.key] ?? rec[m.title]) : undefined;
          if (typeof val === 'number' && Number.isFinite(val)) {
            rSum += val;
            const cSum = (colMetricSums.get(`${c.key}___${m.key}`) ?? 0) + val;
            colMetricSums.set(`${c.key}___${m.key}`, cSum);
            gSum += val;
          }
        }
        rowMetricSums.set(`${r.key}___${m.key}`, rSum);
      }
      grandMetricSums.set(m.key, gSum);
    }

    return {
      rowDimFields,
      colDimFields,
      metrics,
      rowTuples,
      colTuples,
      cellMap,
      indicatorsAsCol,
      showRowTotals,
      rowTotalsLabel,
      showColTotals,
      colTotalsLabel,
      rowMetricSums,
      colMetricSums,
      grandMetricSums,
    };
  }, [isCrossTab, data, config, columnsMeta, t]);

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <TableOutlined />
          <span>{t('转换结果实时预览 (前 10 行)')}</span>
          <Badge status="processing" text={t('实时响应')} />
        </Space>
      }
      extra={
        meta && (
          <Space size={10} wrap>
            {isCrossTab && (
              <Radio.Group
                size="small"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="grid">{t('2D 透视网格')}</Radio.Button>
                <Radio.Button value="flat">{t('1D 扁平明细')}</Radio.Button>
              </Radio.Group>
            )}
            {meta.form === 'detail' && <Tag color="green">{t('全量明细表')}</Tag>}
            {meta.form === 'pivot' && (
              <Tag color={meta.isCrossTab ? 'purple' : 'blue'}>
                {meta.isCrossTab ? t('双向交叉透视表') : t('分组透视表')}
              </Tag>
            )}
            {meta.form === 'summary' && <Tag color="purple">{t('全局汇总卡片')}</Tag>}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('原数据: {input} 行 | 转换输出: {output} 行', {
                input: meta.inputRows,
                output: meta.outputRows,
              })}
            </Text>
            <Tag color="cyan" icon={<ThunderboltOutlined />}>
              {t('计算耗时: {time} ms', { time: meta.executionTimeMs })}
            </Tag>
          </Space>
        )
      }
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ overflowX: 'auto', width: '100%', minHeight: 120 }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#8c8c8c' }}>
            {t('计算中...')}
          </div>
        ) : data.length === 0 || columnsMeta.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#8c8c8c', fontSize: 13 }}>
            {t('配置完成后将在此实时预览转换效果')}
          </div>
        ) : isCrossTab && viewMode === 'grid' && pivotData ? (
          /* ===============================================================
             2D 交叉透视网格视图 (Cross-Tab Pivot Grid)
             =============================================================== */
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            {pivotData.indicatorsAsCol ? (
              /* 指标按列横向排布 (默认) */
              <>
                <thead>
                  {/* 第一行：行维度 + 各列维度分组 + 列总计 */}
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                    {pivotData.rowDimFields.map((f) => (
                      <th
                        key={f}
                        rowSpan={2}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #d9d9d9',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'middle',
                          backgroundColor: '#f5f7fa',
                        }}
                      >
                        <Space size={4}>
                          <span>{config?.headers?.[f] || f}</span>
                          <Tag color="default" style={{ fontSize: 10, margin: 0, padding: '0 3px' }}>
                            {t('行')}
                          </Tag>
                        </Space>
                      </th>
                    ))}
                    {pivotData.colTuples.map((c) => (
                      <th
                        key={c.key}
                        colSpan={pivotData.metrics.length}
                        style={{
                          padding: '6px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #e8e8e8',
                          backgroundColor: '#f0f5ff',
                          color: '#1d39c4',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                    {pivotData.showColTotals && (
                      <th
                        colSpan={pivotData.metrics.length}
                        style={{
                          padding: '6px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #e8e8e8',
                          backgroundColor: '#e6f4ff',
                          color: '#0958d9',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pivotData.colTotalsLabel}
                      </th>
                    )}
                  </tr>
                  {/* 第二行：平铺在各列维度下方的指标 */}
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #d9d9d9' }}>
                    {pivotData.colTuples.map((c) =>
                      pivotData.metrics.map((m) => (
                        <th
                          key={`${c.key}_${m.key}`}
                          style={{
                            padding: '6px 8px',
                            fontWeight: 500,
                            textAlign: 'right',
                            fontSize: 11,
                            borderRight: '1px solid #f0f0f0',
                            borderBottom: '1px solid #d9d9d9',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </th>
                      ))
                    )}
                    {pivotData.showColTotals &&
                      pivotData.metrics.map((m) => (
                        <th
                          key={`col_total_${m.key}`}
                          style={{
                            padding: '6px 8px',
                            fontWeight: 600,
                            textAlign: 'right',
                            fontSize: 11,
                            borderRight: '1px solid #e8e8e8',
                            borderBottom: '1px solid #d9d9d9',
                            backgroundColor: '#f6faff',
                            color: '#0958d9',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.rowTuples.slice(0, 10).map((r, rIdx) => (
                    <tr
                      key={r.key}
                      style={{
                        backgroundColor: rIdx % 2 === 1 ? '#fafcff' : '#ffffff',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      {pivotData.rowDimFields.map((f) => (
                        <td
                          key={f}
                          style={{
                            padding: '6px 10px',
                            fontWeight: 500,
                            borderRight: '1px solid #f0f0f0',
                            whiteSpace: 'nowrap',
                            color: 'rgba(0, 0, 0, 0.88)',
                          }}
                        >
                          {String(r.values[f] ?? '-')}
                        </td>
                      ))}
                      {pivotData.colTuples.map((c) =>
                        pivotData.metrics.map((m) => {
                          const rec = pivotData.cellMap.get(`${r.key}____${c.key}`);
                          const val = rec ? (rec[m.key] ?? rec[m.title]) : undefined;
                          return (
                            <td
                              key={`${c.key}_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                whiteSpace: 'nowrap',
                                color: val === undefined ? '#bfbfbf' : 'rgba(0, 0, 0, 0.85)',
                              }}
                            >
                              {formatValue(val)}
                            </td>
                          );
                        })
                      )}
                      {pivotData.showColTotals &&
                        pivotData.metrics.map((m) => {
                          const rowSum = pivotData.rowMetricSums.get(`${r.key}___${m.key}`);
                          return (
                            <td
                              key={`total_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #e8e8e8',
                                backgroundColor: '#f9fcff',
                                fontWeight: 600,
                                color: '#0958d9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {formatValue(rowSum)}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                  {/* 行总计 */}
                  {pivotData.showRowTotals && (
                    <tr
                      style={{
                        backgroundColor: '#fafafa',
                        borderTop: '2px solid #d9d9d9',
                        fontWeight: 600,
                      }}
                    >
                      <td
                        colSpan={pivotData.rowDimFields.length}
                        style={{
                          padding: '7px 10px',
                          borderRight: '1px solid #e8e8e8',
                          color: 'rgba(0, 0, 0, 0.88)',
                        }}
                      >
                        {pivotData.rowTotalsLabel}
                      </td>
                      {pivotData.colTuples.map((c) =>
                        pivotData.metrics.map((m) => {
                          const colSum = pivotData.colMetricSums.get(`${c.key}___${m.key}`);
                          return (
                            <td
                              key={`rsum_${c.key}_${m.key}`}
                              style={{
                                padding: '7px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                color: '#262626',
                              }}
                            >
                              {formatValue(colSum)}
                            </td>
                          );
                        })
                      )}
                      {pivotData.showColTotals &&
                        pivotData.metrics.map((m) => {
                          const grandSum = pivotData.grandMetricSums.get(m.key);
                          return (
                            <td
                              key={`grand_${m.key}`}
                              style={{
                                padding: '7px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #e8e8e8',
                                backgroundColor: '#e6f4ff',
                                color: '#0958d9',
                                fontWeight: 'bold',
                              }}
                            >
                              {formatValue(grandSum)}
                            </td>
                          );
                        })}
                    </tr>
                  )}
                </tbody>
              </>
            ) : (
              /* 指标按行纵向排布 */
              <>
                <thead>
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #d9d9d9' }}>
                    {pivotData.rowDimFields.map((f) => (
                      <th
                        key={f}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          borderRight: '1px solid #e8e8e8',
                          whiteSpace: 'nowrap',
                          backgroundColor: '#f5f7fa',
                        }}
                      >
                        {config?.headers?.[f] || f}
                      </th>
                    ))}
                    <th
                      style={{
                        padding: '8px 10px',
                        fontWeight: 600,
                        borderRight: '1px solid #e8e8e8',
                        whiteSpace: 'nowrap',
                        backgroundColor: '#f5f7fa',
                      }}
                    >
                      {t('度量指标')}
                    </th>
                    {pivotData.colTuples.map((c) => (
                      <th
                        key={c.key}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          backgroundColor: '#f0f5ff',
                          color: '#1d39c4',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                    {pivotData.showColTotals && (
                      <th
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          backgroundColor: '#e6f4ff',
                          color: '#0958d9',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pivotData.colTotalsLabel}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.rowTuples.slice(0, 10).map((r, rIdx) =>
                    pivotData.metrics.map((m, mIdx) => (
                      <tr
                        key={`${r.key}_${m.key}`}
                        style={{
                          backgroundColor: rIdx % 2 === 1 ? '#fafcff' : '#ffffff',
                          borderBottom:
                            mIdx === pivotData.metrics.length - 1
                              ? '1px solid #d9d9d9'
                              : '1px solid #f0f0f0',
                        }}
                      >
                        {mIdx === 0 &&
                          pivotData.rowDimFields.map((f) => (
                            <td
                              key={f}
                              rowSpan={pivotData.metrics.length}
                              style={{
                                padding: '6px 10px',
                                fontWeight: 500,
                                borderRight: '1px solid #e8e8e8',
                                verticalAlign: 'top',
                                whiteSpace: 'nowrap',
                                color: 'rgba(0, 0, 0, 0.88)',
                              }}
                            >
                              {String(r.values[f] ?? '-')}
                            </td>
                          ))}
                        <td
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid #f0f0f0',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </td>
                        {pivotData.colTuples.map((c) => {
                          const rec = pivotData.cellMap.get(`${r.key}____${c.key}`);
                          const val = rec ? (rec[m.key] ?? rec[m.title]) : undefined;
                          return (
                            <td
                              key={`${c.key}_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                whiteSpace: 'nowrap',
                                color: val === undefined ? '#bfbfbf' : 'rgba(0, 0, 0, 0.85)',
                              }}
                            >
                              {formatValue(val)}
                            </td>
                          );
                        })}
                        {pivotData.showColTotals && (
                          <td
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #e8e8e8',
                              backgroundColor: '#f9fcff',
                              fontWeight: 600,
                              color: '#0958d9',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatValue(pivotData.rowMetricSums.get(`${r.key}___${m.key}`))}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                  {/* 行总计 */}
                  {pivotData.showRowTotals &&
                    pivotData.metrics.map((m, mIdx) => (
                      <tr
                        key={`total_row_${m.key}`}
                        style={{
                          backgroundColor: '#fafafa',
                          borderTop: mIdx === 0 ? '2px solid #d9d9d9' : 'none',
                          borderBottom:
                            mIdx === pivotData.metrics.length - 1
                              ? '1px solid #d9d9d9'
                              : '1px solid #f0f0f0',
                          fontWeight: 600,
                        }}
                      >
                        {mIdx === 0 && (
                          <td
                            rowSpan={pivotData.metrics.length}
                            colSpan={pivotData.rowDimFields.length}
                            style={{
                              padding: '7px 10px',
                              borderRight: '1px solid #e8e8e8',
                              verticalAlign: 'top',
                              color: 'rgba(0, 0, 0, 0.88)',
                            }}
                          >
                            {pivotData.rowTotalsLabel}
                          </td>
                        )}
                        <td
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid #f0f0f0',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </td>
                        {pivotData.colTuples.map((c) => (
                          <td
                            key={`col_sum_${c.key}_${m.key}`}
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #f0f0f0',
                              color: '#262626',
                            }}
                          >
                            {formatValue(pivotData.colMetricSums.get(`${c.key}___${m.key}`))}
                          </td>
                        ))}
                        {pivotData.showColTotals && (
                          <td
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #e8e8e8',
                              backgroundColor: '#e6f4ff',
                              color: '#0958d9',
                              fontWeight: 'bold',
                            }}
                          >
                            {formatValue(pivotData.grandMetricSums.get(m.key))}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </>
            )}
          </table>
        ) : (
          /* ===============================================================
             1D 扁平明细或常规聚合表视图 (Flat Table)
             =============================================================== */
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid #f0f0f0',
                  backgroundColor: '#fafafa',
                  color: 'rgba(0, 0, 0, 0.88)',
                }}
              >
                {columnsMeta.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      padding: '8px 12px',
                      fontWeight: 600,
                      textAlign: col.type === 'number' ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <Space size={4}>
                      <span>{col.title}</span>
                      {col.type === 'number' && (
                        <Tag color="green" style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>
                          123
                        </Tag>
                      )}
                      {col.type === 'time' && (
                        <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>
                          {t('时间')}
                        </Tag>
                      )}
                    </Space>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    backgroundColor: idx % 2 === 1 ? '#fafcff' : '#ffffff',
                  }}
                >
                  {columnsMeta.map((col) => {
                    const val = row[col.key];
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: '7px 12px',
                          textAlign: col.type === 'number' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          color: 'rgba(0, 0, 0, 0.85)',
                        }}
                      >
                        {formatValue(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
};
