# micro-bi (MicroBI)

纯前端高性能轻量级嵌入式 BI 分析套件与 VisActor Canvas 看板引擎。提供多维数据聚合、动态公式计算列、百万级表格与图表展示、同源交叉切片联动以及交互式低代码设计器。

- 零后端数仓依赖，纯前端内存毫秒级聚合与重算
- 纯 Canvas 高性能渲染底座（字节跳动 @visactor/vtable + @visactor/vchart）
- 零运行时计算依赖（内置无 eval 安全 AST 公式解析器）
- 同时产出 **ESM** 与 **CJS** 两套产物，并附带 `.d.ts` 类型声明
- 严格 TypeScript 模式（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）

## 安装

```bash
npm install micro-bi
```

## 核心功能

1. **智能字段推断 (Field Profiler)**：自动检测并分类字段为 `time`（时间）、`number`（数字）、`text`（文本），支持用户手动纠偏。
2. **安全动态公式引擎 (Formula AST)**：
   - 零 `eval`，零外部重量级依赖；
   - 支持四则运算 `+ - * / %`、括号优先级；
   - 支持比较符 `> < >= <= == !=`、逻辑符 `&& || !`；
   - 支持条件分支函数 `IF(condition, trueVal, falseVal)`；
   - 支持数学与字符函数 `ROUND`、`ABS`、`COALESCE`。
3. **时间分桶与聚合切片 (Time Bucketer & Aggregator)**：
   - 支持按日、按周（自然周）、按月、按季度、按年以及自定义天数区间聚合；
   - 支持 `sum`、`avg`、`min`、`max`、`count` 基础度量聚合。
4. **三阶段数据流水线 (Three-Stage Pipeline)**：
   - **`flat` 明细增强模式**：行数不变，追加行级计算列与条件打标；
   - **`aggregate` 聚合汇总模式**：按维度与时间切片折叠，输出指标汇总行与复合加权比率；
   - **`hybrid` 混合模式**：明细行完整保留，同时广播挂载所属分组汇总指标，支持组占比等计算。
5. **行业指标模板热拔插 (Metric Template Registry)**：
   - 支持第三方热插拔注册各行业的预设指标公式与度量（零售、SaaS、财务等）。
6. **可视化配置面板 (React 17 + Ant Design 5)**：
   - 提供 `<DynamicDataConfigWrapper />`、`<DynamicDataConfigPanel />`、`<DynamicDataModal />`、`<DynamicDataDrawer />`；
   - 四区域交互设计：字段探查区、维度/时间切片区、列与公式配置区、实时前 10 行预览表格。

## 使用示例

### 1. 纯计算引擎（Node.js / Web Worker / 浏览器）

```ts
import { transformData, profileDataset } from 'micro-bi';

const rawData = [
  { date: '2026-09-01', category: '电子', sales: 1000, cost: 600 },
  { date: '2026-09-05', category: '电子', sales: 2000, cost: 1200 },
  { date: '2026-09-10', category: '服饰', sales: 500, cost: 200 },
];

// 智能探测字段
const fields = profileDataset(rawData);

// 执行聚合与动态计算
const result = transformData(rawData, {
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
      label: '毛利',
      expression: '[SUM(sales)] - [SUM(cost)]',
    },
    {
      type: 'computed',
      name: 'profit_rate',
      label: '毛利率',
      expression: 'IF([SUM(sales)] > 0, ([SUM(sales)] - [SUM(cost)]) / [SUM(sales)], 0)',
      precision: 4,
    },
  ],
});

console.log(result.data);
// 输出转换后的聚合表格数据
```

### 2. 交互式多维分析展示组件（纯 Canvas 高性能渲染）

```tsx
import React from 'react';
import { DynamicDataView } from 'micro-bi/ui';

export const SalesDashboardCard = ({ dataset, result, config }) => {
  return (
    <DynamicDataView
      datasetId="sales_orders"
      result={result}
      rawDataset={dataset}
      transformConfig={config}
      defaultViewType="bar"
      allowDimensionSwitch={true}
      allowMetricSwitch={true}
      allowViewSwitch={true}
      chartStyle={{ height: 360 }}
    />
  );
};
```

## 子路径导入

- 仅使用计算引擎：`import { transformData } from 'micro-bi'` 或 `micro-bi/engine`
- 仅使用注册表原语：`import { createRegistry } from 'micro-bi/core'`
- 使用 UI 组件与看板：`import { DynamicDataView, DynamicDataConfigPanel } from 'micro-bi/ui'`
- 使用多语言国际化：`import { DynamicDataLocaleProvider, en_US, zh_CN } from 'micro-bi/locale'`


## 开发

```bash
npm install

npm run build      # 清理并构建 ESM + CJS 双产物
npm run build:esm  # 仅构建 ESM
npm run build:cjs  # 仅构建 CJS
npm run typecheck  # 仅类型检查，不产出文件
npm test           # 先构建，再运行 node:test 冒烟测试
```

发布前 `prepublishOnly` 会自动执行一次完整构建，`files` 白名单保证只有 `dist/`、`README.md`、`LICENSE` 进入 tarball。

## 待补充

以下字段依赖实际归属信息，发布到 registry 前建议补齐：

- `package.json` → `repository` / `bugs` / `homepage` / `author`
- `LICENSE` → 版权署名（当前为 `HW`）

## License

[MIT](./LICENSE)
