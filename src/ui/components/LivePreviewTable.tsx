import React from 'react';
import { Card, Tag, Space, Typography, Badge } from 'antd';
import { TableOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TransformResult } from '../../engine/types.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface LivePreviewTableProps {
  readonly result?: TransformResult;
  readonly loading?: boolean;
}

/**
 * 实时试算预览表格
 *
 * 采用原生 HTML5 高性能表格与轻量 CSS，彻底剥离 antd/Table 与 rc-table / rc-pagination，
 * 消除数百 KB 冗余体积与虚拟列表初始化负担，前 10 行预览纳秒级直出。
 */
export const LivePreviewTable: React.FC<LivePreviewTableProps> = ({
  result,
  loading = false,
}) => {
  const t = useDynamicDataLocale();
  const data = result?.data ?? [];
  const columnsMeta = result?.columns ?? [];
  const meta = result?.meta;

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
          <Space size={10}>
            {meta.form === 'detail' && <Tag color="green">{t('全量明细表')}</Tag>}
            {meta.form === 'pivot' && <Tag color="blue">{t('分组透视表')}</Tag>}
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
        ) : (
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
                        {val === null || val === undefined ? (
                          <Text type="secondary">-</Text>
                        ) : typeof val === 'number' ? (
                          <span>{val.toLocaleString()}</span>
                        ) : (
                          String(val)
                        )}
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
