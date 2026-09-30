# @hw/dynamic-data

通用动态数据核心库：提供动态数据的统一类型定义、数据源适配器契约，以及可复用的注册表原语。

- 零运行时依赖
- 同时产出 **ESM** 与 **CJS** 两套产物，并附带 `.d.ts` 类型声明
- 严格 TypeScript 模式（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）

## 安装

```bash
npm install @hw/dynamic-data
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
import { transformData, profileDataset } from '@hw/dynamic-data';

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

### 2. 可视化配置面板（React 17 + Ant Design 5）

```tsx
import React, { useState } from 'react';
import { Button } from 'antd';
import { DynamicDataConfigWrapper } from '@hw/dynamic-data/ui';
import type { DynamicTransformConfig, TransformResult } from '@hw/dynamic-data';

export const MyReportPage = () => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<DynamicTransformConfig>();
  const [transformedResult, setTransformedResult] = useState<TransformResult>();

  return (
    <div>
      <Button type="primary" onClick={() => setOpen(true)}>
        打开数据转换面板
      </Button>

      <DynamicDataConfigWrapper
        variant="modal" // 支持 'modal' | 'drawer' | 'embedded'
        open={open}
        title="报表数据转换配置"
        data={rawDataSource}
        value={config}
        onChange={setConfig}
        onClose={() => setOpen(false)}
        onApply={(newConfig, result) => {
          setConfig(newConfig);
          setTransformedResult(result);
          setOpen(false);
        }}
      />
    </div>
  );
};
```

## 子路径导入

- 仅使用计算引擎：`import { transformData } from '@hw/dynamic-data'` 或 `@hw/dynamic-data/engine`
- 仅使用注册表原语：`import { createRegistry } from '@hw/dynamic-data/core'`
- 使用 UI 面板：`import { DynamicDataConfigWrapper } from '@hw/dynamic-data/ui'`


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
