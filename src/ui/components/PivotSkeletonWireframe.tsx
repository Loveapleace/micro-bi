import React from 'react';
import { Tag, Space, Typography } from 'antd';
import type { DimensionConfig, TimeGranularity } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface PivotSkeletonWireframeProps {
  readonly dimensions?: DimensionConfig | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

interface DimItem {
  readonly id: string;
  readonly field: string;
  readonly label: string;
  readonly type: 'time' | 'category';
  readonly grainLabel?: string | undefined;
  readonly displayLabel: string;
}

const getGranularityLabel = (t: (key: string) => string, g?: TimeGranularity, days?: number): string => {
  if (!g) return '';
  switch (g) {
    case 'hour': return t('时');
    case 'day': return t('日');
    case 'week': return t('周');
    case 'month': return t('月');
    case 'quarter': return t('季');
    case 'year': return t('年');
    case 'custom': return `${days ?? 7}${t('天')}`;
    default: return g;
  }
};

/**
 * 透视骨架示意线框图 (PivotSkeletonWireframe)
 *
 * 极轻量纯 CSS 网格空间拓扑蓝图，常驻在维度配置区右侧。
 * 为业务用户提供毫秒级空间方位直觉：
 * - 🟣 紫色：行维度 (左侧垂直向下多级分组层级)
 * - 🔵 蓝色：列透视维度 (顶部横向向右矩阵展开，支持多级复合表头)
 * - 🟢 绿色：度量指标 (横向列头平铺 vs 纵向行头嵌套)
 * - ⚪ 虚线/实线：行总计 / 列总计
 * - ➔ 底部提供多维层级流向面包屑，清晰解释多维排序与分级机制
 */
export const PivotSkeletonWireframe: React.FC<PivotSkeletonWireframeProps> = ({
  dimensions,
  headers = {},
  className,
  style,
}) => {
  const { t } = useDynamicDataLocale();

  const currentBucket = dimensions?.timeBucket;
  const currentCategories = dimensions?.categories ?? [];
  const currentColumnBucket = dimensions?.columnTimeBucket;
  const currentColumnCategories = dimensions?.columnCategories ?? [];

  const indicatorsAsCol = dimensions?.indicatorsAsCol !== false;
  const showRowGrandTotals = dimensions?.rowTotals?.showGrandTotals !== false;
  const showColGrandTotals = dimensions?.columnTotals?.showGrandTotals !== false;
  const showRowTotals = showRowGrandTotals;
  const showColTotals = showColGrandTotals;

  // 1. 提取所有已配置的行维度 (时间周期 + 分类维度)
  const rowDims: DimItem[] = [];
  if (currentBucket?.field) {
    const f = currentBucket.field;
    const label = headers[f] || f;
    const grainLabel = getGranularityLabel(t, currentBucket.granularity, currentBucket.customIntervalDays);
    rowDims.push({
      id: `time_${f}`,
      field: f,
      label,
      type: 'time',
      grainLabel,
      displayLabel: grainLabel ? `${label} (${grainLabel})` : label,
    });
  }
  for (const f of currentCategories) {
    const label = headers[f] || f;
    rowDims.push({
      id: `cat_${f}`,
      field: f,
      label,
      type: 'category',
      displayLabel: label,
    });
  }

  // 2. 提取所有已配置的列透视维度 (列时间周期 + 列分类维度)
  const colDims: DimItem[] = [];
  if (currentColumnBucket?.field) {
    const f = currentColumnBucket.field;
    const label = headers[f] || f;
    const grainLabel = getGranularityLabel(t, currentColumnBucket.granularity, currentColumnBucket.customIntervalDays);
    colDims.push({
      id: `col_time_${f}`,
      field: f,
      label,
      type: 'time',
      grainLabel,
      displayLabel: grainLabel ? `${label} (${grainLabel})` : label,
    });
  }
  for (const f of currentColumnCategories) {
    const label = headers[f] || f;
    colDims.push({
      id: `col_cat_${f}`,
      field: f,
      label,
      type: 'category',
      displayLabel: label,
    });
  }

  const isCrossTab = colDims.length > 0;

  // 默认行维度占位
  const effectiveRowDims: DimItem[] =
    rowDims.length > 0
      ? rowDims
      : [
          {
            id: 'placeholder_row',
            field: 'row',
            label: t('行维度'),
            type: 'category',
            displayLabel: t('行维度'),
          },
        ];

  // 计算行表头区域宽度百分比 (单维度 30%，多维度 36%)
  const rowAreaWidthPercent = effectiveRowDims.length >= 2 ? 36 : 30;

  return (
    <div
      className={className}
      style={{
        width: '100%',
        maxWidth: 360,
        backgroundColor: '#fafbfc',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '8px 10px',
        boxSizing: 'border-box',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
        ...style,
      }}
    >
      {/* 顶部标题栏与模式徽标 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size={4}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#262626' }}>
            {t('透视骨架示意')}
          </span>
        </Space>
        {isCrossTab ? (
          <Tag color="purple" style={{ margin: 0, fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>
            {indicatorsAsCol ? t('双向 (列平铺)') : t('双向 (行嵌套)')}
          </Tag>
        ) : (
          <Tag color="blue" style={{ margin: 0, fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>
            {t('单向行列表')}
          </Tag>
        )}
      </div>

      {/* 核心微缩网格 (Blueprint Grid) */}
      <div
        style={{
          border: '1px solid #e8e8e8',
          borderRadius: 4,
          backgroundColor: '#ffffff',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {/* =================================================================
            模式 1: 单向行列表 (未配置透视列维度)
            ================================================================= */}
        {!isCrossTab ? (
          <>
            {/* 表头行 */}
            <div style={{ display: 'flex', gap: 3 }}>
              {/* 行表头区域 (支持多个行维度水平拆分) */}
              <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 46 : 35}%`, display: 'flex', gap: 2 }}>
                {effectiveRowDims.slice(0, 2).map((dim) => (
                  <div
                    key={dim.id}
                    style={{
                      flex: 1,
                      padding: '3px 4px',
                      backgroundColor: '#f9f0ff',
                      border: '1px solid #d3adf7',
                      borderRadius: 2,
                      fontSize: 9,
                      fontWeight: 600,
                      color: '#722ed1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                    }}
                    title={dim.displayLabel}
                  >
                    🟣 {dim.displayLabel}
                  </div>
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  padding: '3px 4px',
                  backgroundColor: '#f6ffed',
                  border: '1px solid #b7eb8f',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#389e0d',
                  textAlign: 'center',
                }}
              >
                🟢 ∑ {t('聚合度量指标列')}
              </div>
            </div>

            {/* 示意数据行 */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 46 : 35}%`, display: 'flex', gap: 2 }}>
                {effectiveRowDims.length >= 2 ? (
                  <>
                    <div style={{ flex: 1, padding: '2px 3px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {effectiveRowDims[0]?.type === 'time' ? '2023-01' : '行 1'}
                    </div>
                    <div style={{ flex: 1, padding: '2px 3px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {t('子类 A')}
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 9, color: '#8c8c8c' }}>
                    行 A
                  </div>
                )}
              </div>
              <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 9, color: '#bfbfbf', textAlign: 'center' }}>
                ■■■ ■■■
              </div>
            </div>

            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 46 : 35}%`, display: 'flex', gap: 2 }}>
                {effectiveRowDims.length >= 2 ? (
                  <>
                    <div style={{ flex: 1, padding: '2px 3px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {effectiveRowDims[0]?.type === 'time' ? '2023-01' : '行 1'}
                    </div>
                    <div style={{ flex: 1, padding: '2px 3px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {t('子类 B')}
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 9, color: '#8c8c8c' }}>
                    行 B
                  </div>
                )}
              </div>
              <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 9, color: '#bfbfbf', textAlign: 'center' }}>
                ■■■ ■■■
              </div>
            </div>

            {/* 行总计 */}
            {showRowGrandTotals && (
              <div style={{ display: 'flex', gap: 3, borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>
                <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 46 : 35}%`, padding: '2px 4px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 9, fontWeight: 600, color: '#d46b08', textAlign: 'center' }}>
                  {t('行总计')}
                </div>
                <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 9, color: '#d46b08', textAlign: 'center' }}>
                  ■■■■
                </div>
              </div>
            )}
          </>
        ) : indicatorsAsCol ? (
          /* =================================================================
             模式 2: 双向交叉透视 —— 横向列平铺 (指标在列头最下方)
             支持多级行维度 + 多级复合列维度
             ================================================================= */
          <>
            {/* 表头层 1：各行维度 + 第1层列维度横向展开 + 列总计 */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
              {/* 行维度列表 */}
              <div
                style={{
                  flex: `0 0 ${rowAreaWidthPercent}%`,
                  width: `${rowAreaWidthPercent}%`,
                  maxWidth: `${rowAreaWidthPercent}%`,
                  minWidth: 0,
                  display: 'flex',
                  gap: 2,
                  overflow: 'hidden',
                }}
              >
                {effectiveRowDims.slice(0, 2).map((dim) => (
                  <div
                    key={dim.id}
                    style={{
                      flex: 1,
                      width: '50%',
                      maxWidth: '50%',
                      minWidth: 0,
                      padding: '2px 3px',
                      backgroundColor: '#f9f0ff',
                      border: '1px solid #d3adf7',
                      borderRadius: 2,
                      fontSize: 9,
                      fontWeight: 600,
                      color: '#722ed1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                    }}
                    title={dim.displayLabel}
                  >
                    🟣 {dim.displayLabel}
                  </div>
                ))}
              </div>

              {/* 第1层列维度 */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '2px 4px',
                  backgroundColor: '#e6f4ff',
                  border: '1px solid #91caff',
                  borderRadius: 2,
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#0958d9',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={colDims[0]?.displayLabel}
              >
                🔵 {colDims[0]?.displayLabel || t('列透视维度')}
              </div>

              {showColTotals && (
                <div
                  style={{
                    flex: '0 0 16%',
                    width: '16%',
                    maxWidth: '16%',
                    minWidth: 0,
                    padding: '2px 2px',
                    backgroundColor: '#e6f4ff',
                    border: '1px solid #69b1ff',
                    borderRadius: 2,
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#0958d9',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('列总计')}
                </div>
              )}
            </div>

            {/* 表头层 2 (当存在第2个列维度时展示复合层级) */}
            {colDims.length >= 2 && (
              <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
                <div
                  style={{
                    flex: `0 0 ${rowAreaWidthPercent}%`,
                    width: `${rowAreaWidthPercent}%`,
                    maxWidth: `${rowAreaWidthPercent}%`,
                    minWidth: 0,
                    padding: '1px 3px',
                    fontSize: 8,
                    color: '#8c8c8c',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {effectiveRowDims.length > 2 ? `+${effectiveRowDims.length - 2}维 · ` : ''}{t('(纵向向下)')}
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '1px 3px',
                    backgroundColor: '#f0f5ff',
                    border: '1px solid #adc6ff',
                    borderRadius: 2,
                    fontSize: 8,
                    fontWeight: 600,
                    color: '#1d39c4',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={colDims[1]?.displayLabel}
                >
                  🔵 {colDims[1]?.displayLabel}{colDims.length > 2 ? ` (+${colDims.length - 2})` : ''}
                </div>
                {showColTotals && (
                  <div
                    style={{
                      flex: '0 0 16%',
                      width: '16%',
                      maxWidth: '16%',
                      minWidth: 0,
                      padding: '1px 2px',
                      fontSize: 8,
                      color: '#8c8c8c',
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ∑
                  </div>
                )}
              </div>
            )}

            {/* 表头层 3：平铺在列维度下方的指标 (绿色) */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
              {colDims.length < 2 && (
                <div style={{ flex: `0 0 ${rowAreaWidthPercent}%`, minWidth: 0, padding: '1px 3px', fontSize: 8, color: '#8c8c8c' }}>
                  {effectiveRowDims.length > 2 ? `+${effectiveRowDims.length - 2}维 · ` : ''}{t('(纵向向下)')}
                </div>
              )}
              {colDims.length >= 2 && (
                <div style={{ flex: `0 0 ${rowAreaWidthPercent}%`, minWidth: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 2 }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '1px 2px',
                    backgroundColor: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 2,
                    fontSize: 8,
                    color: '#389e0d',
                    textAlign: 'center',
                  }}
                >
                  🟢 {t('指标1')}
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '1px 2px',
                    backgroundColor: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 2,
                    fontSize: 8,
                    color: '#389e0d',
                    textAlign: 'center',
                  }}
                >
                  🟢 {t('指标2')}
                </div>
              </div>
              {showColTotals && (
                <div
                  style={{
                    flex: '0 0 16%',
                    minWidth: 0,
                    padding: '1px 2px',
                    backgroundColor: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 2,
                    fontSize: 8,
                    color: '#389e0d',
                    textAlign: 'center',
                  }}
                >
                  🟢 ∑
                </div>
              )}
            </div>

            {/* 示意数据行 */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
              <div style={{ flex: `0 0 ${rowAreaWidthPercent}%`, minWidth: 0, display: 'flex', gap: 2 }}>
                {effectiveRowDims.length >= 2 ? (
                  <>
                    <div style={{ flex: 1, minWidth: 0, padding: '2px 2px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {effectiveRowDims[0]?.type === 'time' ? '2023-01' : '行 1'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, padding: '2px 2px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                      {t('子类 A')}
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, minWidth: 0, padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 8, color: '#8c8c8c' }}>
                    {t('行 1')}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 2 }}>
                <div style={{ flex: 1, minWidth: 0, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, textAlign: 'center', color: '#bfbfbf' }}>■■</div>
                <div style={{ flex: 1, minWidth: 0, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, textAlign: 'center', color: '#bfbfbf' }}>■■</div>
              </div>
              {showColTotals && (
                <div style={{ flex: '0 0 16%', minWidth: 0, backgroundColor: '#f9f0ff', border: '1px solid #efdbff', fontSize: 8, textAlign: 'center', color: '#722ed1', fontWeight: 600 }}>■■</div>
              )}
            </div>

            {/* 底部行总计 */}
            {showRowGrandTotals && (
              <div style={{ display: 'flex', gap: 3, borderTop: '1px solid #f0f0f0', paddingTop: 2, alignItems: 'stretch' }}>
                <div style={{ flex: `0 0 ${rowAreaWidthPercent}%`, minWidth: 0, padding: '2px 4px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, fontWeight: 600, color: '#d46b08', textAlign: 'center' }}>
                  {t('行总计')}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 2 }}>
                  <div style={{ flex: 1, minWidth: 0, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', fontSize: 8, textAlign: 'center', color: '#d46b08' }}>■■</div>
                  <div style={{ flex: 1, minWidth: 0, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', fontSize: 8, textAlign: 'center', color: '#d46b08' }}>■■</div>
                </div>
                {showColTotals && (
                  <div style={{ flex: '0 0 16%', minWidth: 0, backgroundColor: '#fff1f0', border: '1px solid #ffa39e', fontSize: 8, textAlign: 'center', color: '#cf1322', fontWeight: 'bold' }}>■■■</div>
                )}
              </div>
            )}
          </>
        ) : (
          /* =================================================================
             模式 3: 双向交叉透视 —— 纵向行嵌套 (指标在行头垂直展开)
             ================================================================= */
          <>
            {/* 表头层：行维度 + 指标列 + 列维度 + 列总计 */}
            <div style={{ display: 'flex', gap: 3 }}>
              {/* 行维度列表 */}
              <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 34 : 26}%`, display: 'flex', gap: 2 }}>
                {effectiveRowDims.slice(0, 2).map((dim) => (
                  <div
                    key={dim.id}
                    style={{
                      flex: 1,
                      padding: '2px 2px',
                      backgroundColor: '#f9f0ff',
                      border: '1px solid #d3adf7',
                      borderRadius: 2,
                      fontSize: 8,
                      fontWeight: 600,
                      color: '#722ed1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                    }}
                    title={dim.displayLabel}
                  >
                    🟣 {dim.displayLabel}
                  </div>
                ))}
              </div>

              <div
                style={{
                  flex: '0 0 24%',
                  padding: '2px 2px',
                  backgroundColor: '#f6ffed',
                  border: '1px solid #b7eb8f',
                  borderRadius: 2,
                  fontSize: 8,
                  fontWeight: 600,
                  color: '#389e0d',
                  textAlign: 'center',
                }}
              >
                🟢 {t('度量指标')}
              </div>

              <div
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  backgroundColor: '#e6f4ff',
                  border: '1px solid #91caff',
                  borderRadius: 2,
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#0958d9',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={colDims[0]?.displayLabel}
              >
                🔵 {colDims[0]?.displayLabel || t('列透视维度')}
              </div>

              {showColTotals && (
                <div
                  style={{
                    flex: '0 0 16%',
                    padding: '2px 2px',
                    backgroundColor: '#e6f4ff',
                    border: '1px solid #69b1ff',
                    borderRadius: 2,
                    fontSize: 8,
                    fontWeight: 600,
                    color: '#0958d9',
                    textAlign: 'center',
                  }}
                >
                  {t('列总计')}
                </div>
              )}
            </div>

            {/* 第2层列头 (如果存在) */}
            {colDims.length >= 2 && (
              <div style={{ display: 'flex', gap: 3 }}>
                <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 34 : 26}%` }} />
                <div style={{ flex: '0 0 24%' }} />
                <div
                  style={{
                    flex: 1,
                    padding: '1px 3px',
                    backgroundColor: '#f0f5ff',
                    border: '1px solid #adc6ff',
                    borderRadius: 2,
                    fontSize: 8,
                    fontWeight: 500,
                    color: '#1d39c4',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={colDims[1]?.displayLabel}
                >
                  🔵 {colDims[1]?.displayLabel}
                </div>
                {showColTotals && (
                  <div style={{ flex: '0 0 16%', fontSize: 8, color: '#8c8c8c', textAlign: 'center' }}>
                    ∑
                  </div>
                )}
              </div>
            )}

            {/* 嵌套数据行 */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div
                style={{
                  flex: `0 0 ${effectiveRowDims.length >= 2 ? 34 : 26}%`,
                  padding: '4px 2px',
                  backgroundColor: '#fafafa',
                  border: '1px dashed #d9d9d9',
                  fontSize: 8,
                  color: '#595959',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                }}
              >
                {effectiveRowDims[0]?.label || '行 1'} (并)
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <div style={{ flex: '0 0 35%', backgroundColor: '#f6ffed', border: '1px solid #d9f7be', fontSize: 8, color: '#389e0d', padding: '1px 2px', textAlign: 'center' }}>
                    🟢 指标1
                  </div>
                  <div style={{ flex: 1, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, color: '#bfbfbf', textAlign: 'center' }}>■■</div>
                  {showColTotals && (
                    <div style={{ flex: '0 0 22%', backgroundColor: '#f9f0ff', fontSize: 8, color: '#722ed1', textAlign: 'center' }}>■■</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <div style={{ flex: '0 0 35%', backgroundColor: '#f6ffed', border: '1px solid #d9f7be', fontSize: 8, color: '#389e0d', padding: '1px 2px', textAlign: 'center' }}>
                    🟢 指标2
                  </div>
                  <div style={{ flex: 1, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, color: '#bfbfbf', textAlign: 'center' }}>■■</div>
                  {showColTotals && (
                    <div style={{ flex: '0 0 22%', backgroundColor: '#f9f0ff', fontSize: 8, color: '#722ed1', textAlign: 'center' }}>■■</div>
                  )}
                </div>
              </div>
            </div>

            {/* 底部行总计 */}
            {showRowGrandTotals && (
              <div style={{ display: 'flex', gap: 3, borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>
                <div style={{ flex: `0 0 ${effectiveRowDims.length >= 2 ? 34 : 26}%`, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, fontWeight: 600, color: '#d46b08', padding: '2px 2px', textAlign: 'center' }}>
                  {t('行总计')}
                </div>
                <div style={{ flex: '0 0 24%', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, color: '#d46b08', textAlign: 'center' }}>
                  🟢 各指标
                </div>
                <div style={{ flex: 1, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, color: '#d46b08', textAlign: 'center' }}>
                  ■■■
                </div>
                {showColTotals && (
                  <div style={{ flex: '0 0 16%', backgroundColor: '#fff1f0', border: '1px solid #ffa39e', fontSize: 8, textAlign: 'center', color: '#cf1322', fontWeight: 'bold' }}>
                    ■■
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部层级排布路径流向 (Dimension Hierarchy Flow) */}
      {(rowDims.length > 0 || colDims.length > 0) && (
        <div
          style={{
            backgroundColor: '#f5f5f5',
            borderRadius: 4,
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            fontSize: 10,
          }}
        >
          {/* 行维度层级 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
            <span style={{ color: '#722ed1', fontWeight: 600, flexShrink: 0, fontSize: 10 }}>
              🟣 {t('行层级')}:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', flexWrap: 'wrap' }}>
              {effectiveRowDims.map((d, idx) => (
                <React.Fragment key={d.id}>
                  {idx > 0 && <span style={{ color: '#8c8c8c', fontSize: 9 }}>➔</span>}
                  <span
                    style={{
                      backgroundColor: '#f9f0ff',
                      border: '1px solid #d3adf7',
                      borderRadius: 2,
                      padding: '0 4px',
                      fontSize: 9,
                      color: '#722ed1',
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={d.displayLabel}
                  >
                    {d.displayLabel}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* 列透视层级 (交叉透视时展示) */}
          {isCrossTab && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
              <span style={{ color: '#0958d9', fontWeight: 600, flexShrink: 0, fontSize: 10 }}>
                🔵 {t('列层级')}:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', flexWrap: 'wrap' }}>
                {colDims.map((d, idx) => (
                  <React.Fragment key={d.id}>
                    {idx > 0 && <span style={{ color: '#8c8c8c', fontSize: 9 }}>➔</span>}
                    <span
                      style={{
                        backgroundColor: '#e6f4ff',
                        border: '1px solid #91caff',
                        borderRadius: 2,
                        padding: '0 4px',
                        fontSize: 9,
                        color: '#0958d9',
                        maxWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={d.displayLabel}
                    >
                      {d.displayLabel}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部极简图例说明 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#8c8c8c', padding: '0 2px' }}>
        <span>🟣 {t('行维度向下')}</span>
        <span>🔵 {t('列透视向右')}</span>
        <span>🟢 {t('指标交汇')}</span>
      </div>
    </div>
  );
};
