# MicroBI (micro-bi)

> 纯前端、高性能、轻量级**嵌入式微型 BI 分析套件与 VisActor Canvas 看板引擎**。  
> 零后端数仓依赖，仅需一份前端 JSON 流水数组，即可实现**多维聚合、时间分桶、动态计算列、百万级表格与图表展示、同源交叉切片联动以及低代码可视化配置**。

[![npm version](https://img.shields.io/badge/npm-v0.1.0-blue.svg)](https://www.npmjs.com/package/micro-bi)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Rendering: VisActor](https://img.shields.io/badge/Rendering-VisActor%20Canvas-cyan.svg)](https://www.visactor.io/)
[![Tests: 94 Passed](https://img.shields.io/badge/Tests-94%20Passing-brightgreen.svg)]()

---

## 🌟 为什么选择 MicroBI？

在传统业务或工业系统中，若想让用户自由分析数据，往往需要搭建繁重的 OLAP 数仓、购买沉重的商业 BI，或者手写大量重复的 ECharts / AntD 表格代码：

- ❌ **传统图表库（ECharts/Chart.js）**：只负责绘制，不负责“数据清洗、时间汇总周期折叠、指标计算与多维透视”，业务方必须在后端写大量 SQL 或在前端写数百行胶水数据重组代码；
- ❌ **重型商业 BI（PowerBI/Tableau/FineBI）**：部署繁琐、成本高昂、无法与自研 Web 业务系统深度融合与精准联动；
- ❌ **传统 DOM 表格**：面对万级以上明细流水时 DOM 节点重排剧烈、性能断崖式下跌。

**MicroBI 提供全新的轻量化破局解法：**
1. **纯前端内存即时算力**：零后端依赖，直接在浏览器端实现多维聚合、时间周期切片与安全公式计算；
2. **纯 Canvas 双引擎渲染**：全链路统一基于字节跳动 `@visactor/vtable` + `@visactor/vchart`，十万至百万级明细极致流畅，原生支持双 Y 轴 Pareto 复合图与多维透视图；
3. **同源数据全卡片联动（Cross-Filtering）**：任意看板中点击柱子、折点或表格单元格，全看板自动秒级完成切片过滤与重算；
4. **低门槛交互式设计器**：仅暴露纯配置面板组件，宿主自由决定弹窗或抽屉形态，业务人员 1 分钟上手配置分析规则。

---

## 📦 安装

```bash
npm install micro-bi
```

如需使用可视化 UI 组件（`DynamicDataView` 或 `DynamicDataConfigPanel`），确保项目中已安装配套基础库：

```bash
npm install @visactor/vtable @visactor/vchart antd @ant-design/icons dayjs
```

---

## 🚀 核心架构与功能特性

```
┌──────────────────────────────────────────────────────────────┐
│                      Host Application                        │
│   (MES / SCADA / ERP / SaaS CRM / Operations Dashboard)      │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
       [ 配置态设计器 ]                 [ 运行时展示看板 ]
 ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │  DynamicDataConfigPanel     │ │      DynamicDataView        │
 │ - 字段探查与纠偏 (Profiler) │ │ - 常驻右上角形态切换 (View) │
 │ - 统计分组与时间汇总周期    │ │ - 次级图表探索栏 (Toolbar)  │
 │ - 指标配置 & 聚合函数       │ │ - 纯 Canvas 图/表双底座     │
 │ - 光标公式编辑器 (Formula)  │ │ - 跨卡片联动 (LinkageBus)   │
 │ - 常用分析预设模板          │ └──────────────┬──────────────┘
 └─────────────┬───────────────┘                │
               │ 输出 DSL 配置                   │ 切片过滤 & 驱动
               ▼                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                 MicroBI In-Memory Engine                    │
 │  - Pipeline: Raw Dataset ➔ Filter ➔ Bucket ➔ Pivot ➔ Schema │
 │  - Safe Formula AST: Lexer ➔ Parser ➔ Sandboxed Evaluator   │
 │  - Metrics & Aggregations: SUM / AVG / MIN / MAX / COUNT    │
 └─────────────────────────────────────────────────────────────┘
```

### 1. 内存计算与 DSL 转换引擎 (`micro-bi` / `micro-bi/engine`)
- **智能字段探查 (Profiler)**：自动检测样本数据并将字段识别为 `time`（时间）、`number`（数值）、`text`（分类文本），支持手动覆盖；
- **多粒度时间分桶**：支持按年、按季、按月、按自然周、按日以及任意自定义天数（如 7 天、14 天滚动周期）聚合；
- **安全无 eval 公式解析引擎 (Formula AST)**：
  - 零 `eval`，零外部重量依赖，彻底规避代码注入漏洞；
  - 支持四则运算优先级、逻辑比较与条件分支（`IF(condition, trueVal, falseVal)`）；
  - 支持数学辅助函数（`ROUND`、`ABS`、`COALESCE`）与聚合引用（`[SUM(sales)]`）。
- **聚合与固定列智能适配**：透视模式与明细模式自动流转，支持原值与度量双向幂等还原。

### 2. 纯 Canvas 高性能展示看板 (`micro-bi/ui` -> `DynamicDataView`)
- **固定右上角形态切换器 (ViewTypeSwitcher)**：表格、柱状图、折线图、饼图切换按钮牢牢固定在卡片右上角，切换视图形态时**像素级绝对稳固、零抖动、零跳跃**；
- **独立次级探索工具条**：维度切换与指标单选/多选对比在非表格状态下平滑呈现于画布上方，不挤压主卡片头部；
- **VisActor Canvas 表格 (`VTable`)**：
  - 轻松承载 100,000+ 明细行，支持区域框选、多格复制（Ctrl+C 粘贴至 Excel）、列宽自由拖拽；
  - 原地无缝数据下钻（In-place Drilldown）穿透原始流水；
  - 列排序隔离的总计行计算、列显隐气泡、冻结首列与右侧操作列；
- **VisActor Canvas 图表 (`VChart`)**：
  - 柱/线/面积/饼图，自动识别比率型与绝对数值型指标，天然呈现**双 Y 轴复合图**；
  - 饼图智能单指标截断与占比归一化。
- **同源交叉切片联动 (Cross-Filtering LinkageBus)**：
  - 基于显式 `datasetId` 契约隔离，防自环广播拓扑；
  - 支持图表图元点击或表格行/列点击，毫秒级下发过滤并自动重算。

### 3. 低代码数据配置面板 (`micro-bi/ui` -> `DynamicDataConfigPanel`)
- **解耦式设计**：面板仅提供标准配置交互与 `ref` 导出，由宿主决定是嵌入弹窗（Modal）还是抽屉（Drawer）；
- **用户友好文案**：全面统一为业务易懂的「统计分组」、「时间汇总周期」、「指标」、「聚合指标」；
- **光标级公式编辑器**：函数与可用字段支持从鼠标光标当前位置精准插入；
- **4 种一键分析预设**：趋势分析（按时间）、对比排行（按类别）、占比分析（单指标）、明细清单（原始行）。

---

## 💡 使用示例

### 示例 1：纯计算引擎（Node.js / Web Worker / 前端逻辑）

```ts
import { transformData, profileDataset, type DynamicTransformConfig } from 'micro-bi';

// 1. 原始流水数据
const rawData = [
  { date: '2026-09-01', category: '电子', sales: 1000, cost: 600, defect: 5 },
  { date: '2026-09-05', category: '电子', sales: 2000, cost: 1200, defect: 8 },
  { date: '2026-09-10', category: '机械', sales: 1500, cost: 800, defect: 3 },
];

// 2. 字段探查
const fields = profileDataset(rawData);

// 3. 配置多维透视与动态公式
const config: DynamicTransformConfig = {
  mode: 'aggregate',
  dimensions: {
    timeBucket: { field: 'date', granularity: 'month' },
    categories: ['category'],
  },
  columns: [
    { type: 'aggregated', field: 'sales', agg: 'sum', label: '总销售额' },
    { type: 'aggregated', field: 'cost', agg: 'sum', label: '总成本' },
    {
      type: 'computed',
      name: 'profit',
      label: '毛利润',
      expression: '[SUM(sales)] - [SUM(cost)]',
    },
    {
      type: 'computed',
      name: 'profit_margin',
      label: '毛利率(%)',
      expression: 'IF([SUM(sales)] > 0, ROUND(([SUM(sales)] - [SUM(cost)]) / [SUM(sales)] * 100, 2), 0)',
      precision: 2,
    },
  ],
};

// 4. 执行内存秒级计算
const result = transformData(rawData, config);
console.log(result.data);
// 输出已聚合、分桶、公式计算后的结果矩阵
```

---

### 示例 2：展示态多维分析看板 (`DynamicDataView`)

```tsx
import React from 'react';
import { DynamicDataView } from 'micro-bi/ui';
import type { TransformResult, DynamicTransformConfig, DataRecord } from 'micro-bi';

interface Props {
  dataset: DataRecord[];
  result: TransformResult;
  config: DynamicTransformConfig;
  onEditConfig: () => void;
}

export const SalesDashboardCard: React.FC<Props> = ({ dataset, result, config, onEditConfig }) => {
  return (
    <DynamicDataView
      datasetId="production_dataset" // 传入一致的 datasetId 即可自动开启跨卡片同源数据联动过滤
      title="月度产能与质检综合透视"
      result={result}
      rawDataset={dataset}
      transformConfig={config}
      defaultViewType="bar"
      allowViewSwitch={true}       // 允许用户自主切换 表格 / 柱状图 / 折线图 / 饼图
      allowDimensionSwitch={true}  // 开启图表 X 轴多维度切换
      allowMetricSwitch={true}     // 开启度量指标切换与多指标对比
      chartStyle={{ height: 380 }}
      tableFeatures={{
        drilldown: 'inplace',      // 原地无缝下钻穿透原始流水
        export: true,              // 允许导出 CSV 与复制 TSV
        summaryRow: true,          // 底部科学总计行
        columnVisibility: true,    // 列显隐管理
        filterDropdown: true,      // 表格列快速检索
      }}
      extra={
        <button onClick={onEditConfig} style={{ cursor: 'pointer' }}>
          配置
        </button>
      }
    />
  );
};
```

---

### 示例 3：自主掌控容器的配置面板 (`DynamicDataConfigPanel`)

配置组件与外层容器完全解耦，宿主可按需放入 Ant Design 的 `Modal` 或 `Drawer` 中：

```tsx
import React, { useRef, useState } from 'react';
import { Modal, Button } from 'antd';
import { DynamicDataConfigPanel, type DynamicDataConfigPanelRef } from 'micro-bi/ui';
import type { DynamicTransformConfig } from 'micro-bi';

export const ConfigModal: React.FC<{
  open: boolean;
  initialConfig: DynamicTransformConfig;
  rawDataset: any[];
  onSave: (config: DynamicTransformConfig) => void;
  onCancel: () => void;
}> = ({ open, initialConfig, rawDataset, onSave, onCancel }) => {
  const panelRef = useRef<DynamicDataConfigPanelRef>(null);

  const handleOk = () => {
    // 通过 ref 统一校验并获取当前最新的合法 DSL 配置
    if (panelRef.current) {
      const finalConfig = panelRef.current.getConfig();
      onSave(finalConfig);
    }
  };

  return (
    <Modal open={open} width={960} onOk={handleOk} onCancel={onCancel} title="配置分析规则">
      <DynamicDataConfigPanel
        ref={panelRef}
        initialConfig={initialConfig}
        data={rawDataset}
        showDslTools={true} // 支持快捷导入/导出 DSL JSON 配置
      />
    </Modal>
  );
};
```

---

### 示例 4：双语国际化支持 (i18n)

MicroBI 内置中英双语，开箱即用：

```tsx
import React, { useState } from 'react';
import { DynamicDataLocaleProvider, en_US, zh_CN } from 'micro-bi/locale';

export const App = () => {
  const [isEn, setIsEn] = useState(false);

  return (
    <DynamicDataLocaleProvider locale={isEn ? en_US : zh_CN}>
      <button onClick={() => setIsEn((v) => !v)}>
        {isEn ? 'Switch to Chinese' : '切换为英文'}
      </button>
      {/* 内部所有组件与图表文字自动切换双语 */}
    </DynamicDataLocaleProvider>
  );
};
```

---

## 📚 子路径导入规范

为保持最优的 Tree-shaking 体验，MicroBI 提供了清晰的模块拆分：

| 导入路径 | 包含模块与用途 | 适合场景 |
| :--- | :--- | :--- |
| **`micro-bi`** | `transformData`, `profileDataset`, 核心 TypeScript 类型 | 纯数据计算、轻量后端、Web Worker |
| **`micro-bi/ui`** | `DynamicDataView`, `DynamicDataConfigPanel`, 主题工具 | 前端 React 看板集成、可视化配置 |
| **`micro-bi/core`**| 通用注册表原语（`createRegistry`） | 高级插件扩展与行业指标注册 |
| **`micro-bi/locale`**| `DynamicDataLocaleProvider`, `zh_CN`, `en_US` | 国际化语言注入 |

---

## 🛠️ 本地开发与贡献

```bash
# 1. 安装依赖
npm install

# 2. 构建产物 (ESM + CJS + .d.ts)
npm run build

# 3. 运行全量冒烟测试 (Node.js 内置 test runner，94 tests)
npm test

# 4. 纯类型检查
npm run typecheck
```

---

## 📄 开源许可

本项目遵循 [MIT License](./LICENSE)。
