# 模式一VChart专用配置：实施与验收

日期：2026-10-27。状态：**已实现并完成本轮验收**。本轮只改造模式一，模式二/三的编辑器定位与往返约束没有实施变更；第44节下钻功能仍是待办。

2026-10-28更新：模式二已按用户决定下线，表格仅保留模式三受控配置，不提供往返转换。当前边界及最新409项验证见[模式二下线与模式三受控编辑](mode2-retirement-and-guided-editing-2026-10-28.md)；本文后续“保留模式二”及测试数量均为10月27日的实施记录。

## 1. 使用入口与能力范围

原“新建分析看板”默认进入图表分析，菜单中模式一改为“图表分析新建（模式一：VChart）”。模式一只提供柱状图、折线图、饼图，右侧为实际VChart实时预览，保存后也由VChart展示。

删除该入口中的table视图、双向交叉行列配置、Excel画布及工作簿保存。模式三继续承接表格报表，模式二继续提供自由单元格设计。

| 分区 | 已实现配置 |
| --- | --- |
| 数据与维度 | 数据源选择、字段探查/类型修正、横轴或分类维度、时间分桶、可选系列维度 |
| 数据处理 | 事实筛选、分类/指标排序、分类Top N；Top N保留所选分类的全部系列 |
| 指标与公式 | SUM/AVG/COUNT/MIN/MAX、行级或汇总业务公式、名称、左右轴、单位、指标顺序 |
| 图形样式 | 图例、数值标签、同轴柱状图堆叠、折线平滑、自定义调色盘及主题配色恢复 |

柱状图中的右轴指标以折线呈现，支持数量与比率的双轴组合。饼图要求单指标、无系列；配置不满足时显示具体原因并阻止保存，不自动删除多余指标。饼图只绘制正值，原聚合结果保持。

模板类能力、更多图种、完整VChart原始spec编辑、图表交互下钻及Excel操作不是本轮交付范围。

## 2. 新配置协议与数据链路

模式一唯一源为`ChartConfigV1`，根标识`kind='chart-config'`、`version=1`。保存数据源、图形类型、分类与系列字段、指标及公式、筛选、排序/Top N和样式；不保存ReportDocument、publication、工作簿或某一次查询结果。

完整可用配置见[车间交付图表示例](../examples/charts/workshop-delivery-chart.json)。库公开入口如下：

```tsx
import { createChartConfig, compileChart, type ChartConfigV1 } from 'micro-bi';
import { ChartConfigPanel, ChartView } from 'micro-bi/ui';
```

运行链路：数据注册/加载→事实筛选→复用现有聚合与公式引擎→分类/系列展平记录→图表spec→共用VChart渲染生命周期。模式一不消费双向透视矩阵，也不从表格显示文字反推指标。

平均值按事实记录计算，比率公式按当前事实切片重新求分子/分母。按指标排序分类时，再计算分类汇总作为排名依据，不将各系列的AVG或比率直接求和。日期按选择的粒度分桶。

`VChartView`新增可选`specMode='replace'`供完整图表投影复用；默认仍为merge，原有调用保持原行为。replace路径直接使用新spec，复用现有实例释放、ResizeObserver和更新逻辑。

## 3. 不兼容旧模式一配置

不读取旧模式一的`config`表格DSL、`report.document`、publication或Univer快照，不提供迁移、回读、双写或旧预设还原。新模式一配置自身仍做结构、字段、公式和图形组合校验。

宿主恢复看板列表时，只接受新图表条目及既有`cell`/`hybrid`报表条目。旧模式一条目被过滤，持久化写入当前有效列表；若只存在旧模式一，则显示新的默认预设。模式二/三报表不因此转换或删除。

预设一～三重新编写为新图表配置；原双向表预设由模式三模板承接，不进入图表配置。模式二复杂报表示例继续保留。

## 4. 主要修改

| 位置 | 修改 |
| --- | --- |
| `src/chart/` | ChartConfigV1、字段探查、结构/公式校验、事实筛选和图表编译；从库根入口导出 |
| `src/ui/ChartConfigPanel.tsx` | 模式一专用面板、异步数据源、初始化、最新配置保存屏障及实时预览 |
| `src/ui/presentation/charts/chartSpec.ts`、`ChartView.tsx` | 新图表投影及两端共用展示，保留数值与单位，不执行二次汇总 |
| `VChartView.tsx` | 完整spec替换方式，保留默认合并方式及原生命周期 |
| `FormulaEditorModal.tsx` | 增加chart使用场景，复用公式编辑并显示指标文案，原表格使用场景不变 |
| 宿主`DashboardEditModal.tsx` | 改用ChartConfigPanel，移除Univer/CSS、ReportConfigPanel和工作簿保存依赖 |
| 宿主`DashboardCard.tsx`、`App.tsx`、`types/dashboard.ts` | 图表源保存/恢复、图表与报表展示分流，旧模式一不进入新入口 |
| 宿主`constants/presets.ts`、`HeaderBar.tsx` | 新图表预设及模式一入口名称，双向表交给模式三 |
| `test/chart.test.mjs` | 新增29项真实编译/投影回归，不仅检查源码文字 |

## 5. 验收结果

| 检查 | 结果 |
| --- | --- |
| 库构建 | ESM/CJS及声明通过 |
| 宿主构建 | TypeScript/Vite通过，既有大包提示保留 |
| 新增图表专项 | **29/29通过** |
| 全库测试 | **402/402通过**，原373项保留 |
| 原入口浏览器 | **15/15通过**，独立Playwright上下文，不修改用户已有看板存储 |
| 编辑依赖隔离 | 初始页面及模式一打开期间0次Univer请求；生产入口与图表编辑器静态依赖检查无Univer标记，编辑器无Univer CSS依赖 |

本轮通过实际UI完成分类/指标选择、业务公式、左右轴、系列、筛选、排序/Top N、折线平滑、饼图约束、自定义颜色、保存刷新重开；验证异步加载期间阻止保存，晚返回的源不覆盖当前源，1366×768配置和保存按钮可见。模式二及模式三分别通过原入口打开、保存回归；不扩大为自由模板全部边界重新验收。

旧模式一及新图表/模式三混合存储夹具中，旧条目不显示，既有模式三仍显示，新图表正常保存；没有自动转换旧图表。

### 5.1 数据变化

通过实际UI保存“车间分类、交付求和”图表后，不重存配置，在隔离浏览器响应夹具中改变事实：

| 场景 | 来源记录 | 分类数 | 交付合计 |
| --- | --- | --- | --- |
| 基线 | 13 | 3 | 10850 |
| 新增车间与321件 | 14 | 4 | 11171 |
| 14条逆序 | 14 | 4 | 11171 |
| 删除原首车间 | 8 | 3 | 6771 |
| 清空 | 0 | 0 | 空态，无伪造图形 |
| 将原600改1600 | 13 | 3 | 11850 |
| 恢复 | 13 | 3 | 10850 |

浏览器核对来源/筛选/分组数量、真实图形及恢复画面；数值用相同的公共编译器和UI保存的源配置核对，不冒充读取Canvas内部私有状态。图表不保存静态结果，数据加载或注册版本变化后重新计算。

### 5.2 证据与复验

证据：[浏览器逐项结果](verification/mode1-vchart-2026-10-27/browser.json)、[数据变化](verification/mode1-vchart-2026-10-27/data-changes.json)、[构建隔离](verification/mode1-vchart-2026-10-27/bundle-isolation.json)、[源码及检查汇总](verification/mode1-vchart-2026-10-27/checks.json)、[保存配置](verification/mode1-vchart-2026-10-27/saved-chart-config.json)。

画面：[新预设](verification/mode1-vchart-2026-10-27/01-new-chart-presets.png)、[专用面板](verification/mode1-vchart-2026-10-27/02-mode1-chart-only-panel.png)、[公式与双轴](verification/mode1-vchart-2026-10-27/03-dual-axis-formula-and-style.png)、[系列/筛选/Top N](verification/mode1-vchart-2026-10-27/04-series-filter-topn.png)、[饼图和颜色](verification/mode1-vchart-2026-10-27/05-pie-filtered-chart.png)、[保存后的饼图](verification/mode1-vchart-2026-10-27/06-saved-pie-card.png)、[动态基线](verification/mode1-vchart-2026-10-27/07-dynamic-baseline.png)、[恢复数据](verification/mode1-vchart-2026-10-27/08-data-restored.png)、[小屏及源隔离](verification/mode1-vchart-2026-10-27/09-laptop-source-isolation.png)。

```powershell
# micro-bi
npm test
# 库构建完成后，在dynamic-data-test
npm run build
npm run dev
```

本轮不宣称更多图种、实时推送通道或浏览器大数据容量通过。浏览器pageerror为0，既有AntD静态message主题提示及Modal弃用提示保留；模式二/三生命周期观察H3-OBS01未关闭。响应夹具已移除，开发服务保留，本轮未自动提交Git。
