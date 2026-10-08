import React from 'react';
import { Tag, Space, Typography } from 'antd';
import type { DimensionConfig } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface PivotSkeletonWireframeProps {
  readonly dimensions?: DimensionConfig | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

/**
 * 透视骨架示意线框图 (PivotSkeletonWireframe)
 *
 * 极轻量 (<2.5KB) 纯 CSS 网格空间拓扑蓝图，常驻在维度配置区右侧。
 * 为业务用户提供毫秒级空间方位直觉：
 * - 🟣 紫色：行维度 (左侧垂直向下)
 * - 🔵 蓝色：列维度 (顶部横向向右)
 * - 🟢 绿色：度量指标 (横向列头下方 vs 纵向行头嵌套)
 * - ⚪ 虚线/实线：行总计 / 列总计
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

  const hasRowDims = Boolean(currentBucket?.field || currentCategories.length > 0);
  const hasColDims = Boolean(currentColumnBucket?.field || currentColumnCategories.length > 0);
  const isCrossTab = hasColDims;
  const indicatorsAsCol = dimensions?.indicatorsAsCol !== false;
  const showRowGrandTotals = dimensions?.rowTotals?.showGrandTotals !== false;
  const showColGrandTotals = dimensions?.columnTotals?.showGrandTotals !== false;
  const showRowTotals = showRowGrandTotals;
  const showColTotals = showColGrandTotals;

  // 提取行维度标签
  const rowFieldKey = currentCategories[0] || currentBucket?.field;
  const rowLabel = rowFieldKey ? (headers[rowFieldKey] || rowFieldKey) : t('行维度');

  // 提取列维度标签
  const colFieldKey = currentColumnCategories[0] || currentColumnBucket?.field;
  const colLabel = colFieldKey
    ? (headers[colFieldKey] || colFieldKey) + (currentColumnBucket?.granularity ? ` (${currentColumnBucket.granularity})` : '')
    : t('列透视维度');

  return (
    <div
      className={className}
      style={{
        width: '100%',
        maxWidth: 320,
        backgroundColor: '#fafafa',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        padding: '8px 10px',
        boxSizing: 'border-box',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
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
            模式 1: 单向行分组表 (未配置透视列维度)
            ================================================================= */}
        {!isCrossTab ? (
          <>
            {/* 表头行 */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div
                style={{
                  flex: '0 0 35%',
                  padding: '3px 4px',
                  backgroundColor: '#f9f0ff',
                  border: '1px solid #d3adf7',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#722ed1',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={rowLabel}
              >
                🟣 {rowLabel}
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
              <div style={{ flex: '0 0 35%', padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 9, color: '#8c8c8c' }}>
                行 A
              </div>
              <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 9, color: '#bfbfbf', textAlign: 'center' }}>
                ■■■ ■■■
              </div>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: '0 0 35%', padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 9, color: '#8c8c8c' }}>
                行 B
              </div>
              <div style={{ flex: 1, padding: '2px 4px', backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 9, color: '#bfbfbf', textAlign: 'center' }}>
                ■■■ ■■■
              </div>
            </div>

            {/* 行总计 */}
            {showRowGrandTotals && (
              <div style={{ display: 'flex', gap: 3, borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>
                <div style={{ flex: '0 0 35%', padding: '2px 4px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 9, fontWeight: 600, color: '#d46b08' }}>
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
             模式 2: 双向交叉透视 —— 横向列展开 (指标在列头下方)
             ================================================================= */
          <>
            {/* 表头层 1：行维度 + 列维度横向展开 + 列总计 */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div
                style={{
                  flex: '0 0 30%',
                  padding: '2px 4px',
                  backgroundColor: '#f9f0ff',
                  border: '1px solid #d3adf7',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#722ed1',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={rowLabel}
              >
                🟣 {rowLabel}
              </div>
              <div
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  backgroundColor: '#e6f4ff',
                  border: '1px solid #91caff',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#0958d9',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={colLabel}
              >
                🔵 {colLabel}
              </div>
              {showColTotals && (
                <div
                  style={{
                    flex: '0 0 20%',
                    padding: '2px 2px',
                    backgroundColor: '#e6f4ff',
                    border: '1px solid #69b1ff',
                    borderRadius: 2,
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#0958d9',
                    textAlign: 'center',
                  }}
                >
                  {t('列总计')}
                </div>
              )}
            </div>

            {/* 表头层 2：平铺在列维度下方的指标 (绿色) */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: '0 0 30%', padding: '1px 4px', fontSize: 8, color: '#8c8c8c' }}>
                {t('(纵向展开)')}
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                <div
                  style={{
                    flex: 1,
                    padding: '1px 2px',
                    backgroundColor: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 2,
                    fontSize: 8,
                    color: '#389e0d',
                    textAlign: 'center',
                    transition: 'all 0.25s ease',
                  }}
                >
                  🟢 {t('指标1')}
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: '1px 2px',
                    backgroundColor: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 2,
                    fontSize: 8,
                    color: '#389e0d',
                    textAlign: 'center',
                    transition: 'all 0.25s ease',
                  }}
                >
                  🟢 {t('指标2')}
                </div>
              </div>
              {showColTotals && (
                <div
                  style={{
                    flex: '0 0 20%',
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
            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: '0 0 30%', padding: '2px 4px', backgroundColor: '#fafafa', border: '1px dashed #d9d9d9', fontSize: 9, color: '#8c8c8c' }}>
                行 1
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                <div style={{ flex: 1, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, textAlign: 'center', color: '#bfbfbf' }}>■■</div>
                <div style={{ flex: 1, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, textAlign: 'center', color: '#bfbfbf' }}>■■</div>
              </div>
              {showColTotals && (
                <div style={{ flex: '0 0 20%', backgroundColor: '#f9f0ff', border: '1px solid #efdbff', fontSize: 8, textAlign: 'center', color: '#722ed1', fontWeight: 600 }}>■■</div>
              )}
            </div>

            {/* 底部行总计 */}
            {showRowGrandTotals && (
              <div style={{ display: 'flex', gap: 3, borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>
                <div style={{ flex: '0 0 30%', padding: '2px 4px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 9, fontWeight: 600, color: '#d46b08' }}>
                  {t('行总计')}
                </div>
                <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                  <div style={{ flex: 1, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', fontSize: 8, textAlign: 'center', color: '#d46b08' }}>■■</div>
                  <div style={{ flex: 1, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', fontSize: 8, textAlign: 'center', color: '#d46b08' }}>■■</div>
                </div>
                {showColTotals && (
                  <div style={{ flex: '0 0 20%', backgroundColor: '#fff1f0', border: '1px solid #ffa39e', fontSize: 8, textAlign: 'center', color: '#cf1322', fontWeight: 'bold' }}>■■■</div>
                )}
              </div>
            )}
          </>
        ) : (
          /* =================================================================
             模式 3: 双向交叉透视 —— 纵向行展开 (指标在行头垂直嵌套)
             ================================================================= */
          <>
            {/* 表头层：行维度 + 指标列 + 列维度 + 列总计 */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div
                style={{
                  flex: '0 0 28%',
                  padding: '2px 4px',
                  backgroundColor: '#f9f0ff',
                  border: '1px solid #d3adf7',
                  borderRadius: 2,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#722ed1',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={rowLabel}
              >
                🟣 {rowLabel}
              </div>
              <div
                style={{
                  flex: '0 0 26%',
                  padding: '2px 2px',
                  backgroundColor: '#f6ffed',
                  border: '1px solid #b7eb8f',
                  borderRadius: 2,
                  fontSize: 9,
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
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#0958d9',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={colLabel}
              >
                🔵 {colLabel}
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

            {/* 嵌套数据行 (车间 1 内部展开多个指标) */}
            <div style={{ display: 'flex', gap: 3 }}>
              <div
                style={{
                  flex: '0 0 28%',
                  padding: '4px 3px',
                  backgroundColor: '#fafafa',
                  border: '1px dashed #d9d9d9',
                  fontSize: 9,
                  color: '#595959',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                行 1 (合并)
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <div style={{ flex: '0 0 35%', backgroundColor: '#f6ffed', border: '1px solid #d9f7be', fontSize: 8, color: '#389e0d', padding: '1px 2px' }}>
                    🟢 指标1
                  </div>
                  <div style={{ flex: 1, backgroundColor: '#fcfcfc', border: '1px dashed #e8e8e8', fontSize: 8, color: '#bfbfbf', textAlign: 'center' }}>■■</div>
                  {showColTotals && (
                    <div style={{ flex: '0 0 22%', backgroundColor: '#f9f0ff', fontSize: 8, color: '#722ed1', textAlign: 'center' }}>■■</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <div style={{ flex: '0 0 35%', backgroundColor: '#f6ffed', border: '1px solid #d9f7be', fontSize: 8, color: '#389e0d', padding: '1px 2px' }}>
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
                <div style={{ flex: '0 0 28%', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, fontWeight: 600, color: '#d46b08', padding: '2px 2px' }}>
                  {t('行总计')}
                </div>
                <div style={{ flex: '0 0 26%', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 2, fontSize: 8, color: '#d46b08', textAlign: 'center' }}>
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

      {/* 底部极简图例说明 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#8c8c8c', padding: '0 2px' }}>
        <span>🟣 行维度向下</span>
        <span>🔵 列透视向右</span>
        <span>🟢 指标交汇</span>
      </div>
    </div>
  );
};
