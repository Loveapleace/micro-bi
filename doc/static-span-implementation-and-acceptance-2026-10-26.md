# 静态单元格与区域范围跟随：实现和验收

日期：2026-10-26。对应整改清单第33节。**已实现并验收**：任意位置的静态文字格或单一文字静态区域，可跟随目标动态区域的实际列范围扩宽并默认居中，贯通模板设计、动态预览、源模板保存重开及VTable展示。行号、标题类型和特定单元格ID均不是通用执行条件。

## 操作入口

在原主应用进入模式三，或打开已有单元格报表：

1. 切到模板设计态，双击静态文字格；模式三也可直接双击空白格创建静态文字。
2. 打开高级设置的“范围跟随”页，输入文字，选择“目标报表全宽”“仅动态列区域”或“所属列分组宽度”。
3. 选择同一工作表中的目标动态区域、出现上下文和位置锚定；根据需要设置父分组、偏移、区域高度及是否包含末尾总计。
4. 首次启用默认水平/垂直居中；字体、颜色、背景、换行等仍在“样式与排版”设置。
5. 切换动态预览核对，点击保存报表。VTable消费同一份编译结果，展示端不使用Univer。

本次验收从G12创建表尾说明，从J16创建每车间组前说明，这些地址仅为证明位置不限，不是使用要求。已有业务字段格保留绑定保护；“范围跟随”针对静态内容，不把业务字段格静默转换为文字。

| 设置 | 行为 |
| --- | --- |
| 固定范围 | 回到普通静态格/原有手工合并，不执行动态范围跟随；已有跟随参数仍可保留。 |
| 目标报表全宽 | 覆盖目标区域的行维度标签、指标标签及实际动态叶列，末尾总计可选。 |
| 仅动态列区域 | 从实际数据列起点开始，排除左侧标签；末尾总计可选。 |
| 所属列分组宽度 | 按指定列父格各实例的footprint计算范围，不包含整表末尾总计。 |
| 整个目标区域一次 | 文字出现一次，不按每个叶列重复。 |
| 每个行分组一次 | 按所选行父格的完整分组上下文生成；新增下级叶组不会把父组说明重复成每个叶组一条。 |
| 每个列分组一次 | 按列父组生成；与行分组结合时，在每个行列父组交叉上下文中各出现一次。 |
| 模板位置 / 组内偏移 | 使用源位置或父格实例内相对位置；落在业务区时预留行带。 |
| 区域前/后、分组前/后 | 先根据真实区域/父组定位行，再计算横向范围；组前/后需选择分组上下文。 |
| 静态区域高度 | 配置区域占用几行，不是字号或像素行高；已有源行高规则跟随实际落点。 |
| 合并显示 | 独立控制是否合并；关闭后仍保留范围、锚点、出现次数、文字与逻辑高度。 |

居中相对于最终区域的实际列宽之和，不是浏览器窗口或当前可见画布。工作表预留空列及目标区域外的备注，不会被当作目标报表宽度。

## 源模型与运行链路

规则保存在`template.cells[].staticSpan`，不依赖某次预览的绝对结束列：

```ts
interface StaticSpanConfig {
  id: string;
  enabled: boolean;
  regionId: string;
  scope: 'report' | 'columns' | 'column-group';
  placement: 'template' | 'before-region' | 'after-region' | 'before-group' | 'after-group';
  repeat: 'once' | 'row-groups' | 'column-groups';
  rowParentId?: string;
  columnParentId?: string;
  rowOffset: number;
  height: number;
  includeTotals: boolean;
  merge: boolean;
  templateRange?: CellMergeRange;
  suppressions: string[];
}
```

`templateRange`只描述原静态源区域形状及固定模式的选区，运行时结束列由目标区域计算。静态源格移动后按其当前位置解释源宽高，不锁死旧选区坐标。源区域只允许一个非空静态内容；其他非空内容或人工合并冲突会诊断并阻止发布，不能通过合并吞掉另一个文字。

运行顺序：

1. 从普通父格推断与原型尺寸测量中暂时排除启用的静态跟随源，避免文字改变业务展开或被数据覆盖。
2. 原引擎完成行列展开、事实交集、公式、已有覆盖和样式；静态源样式样本复用相同的数值格式及条件格式管道。
3. 根据目标区域真实业务绑定/父格实例计算边界及完整上下文身份；空数据使用最小合法原型范围。
4. 为表中、组前/组内/组后说明保留行带，并移动业务格、绑定、行高及合并。遇到穿过说明的生成标签覆盖时拆成不重叠片段，避免覆盖文字或数据；人工规则冲突不擅自改写。
5. 生成每个上下文一次的文字、布局范围、居中样式和有来源的合并。取消合并后也保留区域末尾空行，避免发布裁边丢失多行高度。
6. 输出同一份中性grid/publication给Univer预览和VTable，保存源规则。数据源版本变化后重新编译模板即可得到新的范围。

仅保留旧publication而不重编译模板，无法消费新数据。本项目宿主已有登记数据版本刷新并重编译hybrid保存包的链路；接入其他宿主时应沿用该契约。

## 取消与恢复合并

- 对“整个区域一次”的实际合并执行原生取消，保存为该源规则的`merge=false`，`enabled`及其他参数不删除。
- 对重复分组中的一个合并执行取消，保存完整的实例身份到`suppressions`；数据增删、排序或宽度改变后仍匹配同一父组，不根据旧行号/列号取消另一个组。
- 暂时删除数据成员不会删例外；相同完整父组身份恢复时，例外重新匹配。改变上级分组结构产生不同身份时，旧例外保留，不强套给新上下文。
- 高级设置显示保留的局部取消数，“恢复全部范围合并”可显式清除例外；“合并显示”可显式恢复整条规则。
- 原生重新合并同一实际多格范围，可回写对应源状态，而不是新增一次性展开坐标。单格没有实际合并时，可直接通过“合并显示”控制后续数据展开的行为。
- 源文字和规则在模板设计态编辑；预览支持上述合并意图采集。源静态跟随与原有固定手工合并互斥计算，固定模式按原固定来源执行。

## 源码落点和兼容

| 文件 | 改动 |
| --- | --- |
| `report-template/types.ts`、`report/types.ts` | 静态源规则、实例范围与合并来源的类型。 |
| `report-template/staticSpans.ts` | 校验、源区域互斥、设计态源选区、运行时边界/上下文、行带、冲突、样式与范围实例。 |
| `cell-designer/StaticSpanSettings.tsx`、`CellAdvancedSettings.tsx` | 共用高级设置入口及静态文字编辑，原数值未改文字时保留原值类型。 |
| `cell-designer/HybridCellDesigner.tsx`、`CellReportDesigner.tsx`、`designerReducer.ts` | 原入口、空白格创建、源编辑、草稿及保存接线。 |
| `cell-designer/staticSpanIntent.ts`、`syncWorkbookToTemplate.ts`、`hybridMergeState.ts` | 原生取消/恢复回写，过滤投影，保留源固定规则，防止未编辑保存固化或取消后复活。 |
| `cell-designer/hybridTemplateState.ts` | 保留未应用到画布的新设置，原生新输入优先；按身份迁移父格和源配置；保留全局样式、条件及已有实例覆盖。 |
| `cellExpansionEngine.ts`、`expandTemplate.ts`、`mergeResolver.ts` | 新旧数据引擎共用范围解析；旧投影数据语义不改变；新标题作为普通规则预设，旧标题特例仅作旧源兼容。 |
| `compileCellReport.ts` | 发布使用真实运行时行高及范围，VTable只消费中性结果。 |

同时修复：独立区域共享表头行时的横向误推移；自动标签快照被误当成用户改名而锁死字段文字；未编辑静态合并误触发其他组策略关闭；旧版本禁用的标题合并升级后复活；旧画布快照覆盖尚未应用的高级设置。源文字覆盖仅在用户显式改名时生效，业务字段绑定继续受保护。

## 自动化验收

新增[`test/static-span.test.mjs`](../test/static-span.test.mjs)，35项专项。全部采用真实编译、同步与VTable适配函数，不以检查源码字符串代替行为断言。

| 用例 | 覆盖 |
| --- | --- |
| SS-01～04 | 任意源行、仅动态列、总计开关、区域前后锚点、数值与样式发布。 |
| SS-05～09 | 组前、组内、组后、二维静态区域高度、首个业务行预留空间，业务值不变。 |
| SS-10～12 | 数据增删/逆序、JSON往返、空数据、区域外远处备注不拉宽目标。 |
| SS-13～17 | 局部取消、整条取消、原生恢复、不固化投影、设计态取消后源参数保留。 |
| SS-18～22 | 非空/格式化空显示及人工合并冲突、规则重叠、父格错误、列父组范围、并排区域隔离、旧投影器。 |
| SS-23～27 | 标题通用预设、策略误关闭回归、自动标签与显式改名、分组父格重绑定、未合并区域高度及源行高。 |
| SS-28～35 | 自由设计器草稿/撤销重做/连续输入、类型化组身份、不同列宽及边框颜色、旧取消迁移、数字格式和条件样式、旧快照优先级、固定模式、全局规则及已有覆盖不丢。 |

| 执行 | 结果 | 证据 |
| --- | --- | --- |
| 范围跟随专项 | 35/35通过 | [专项日志](verification/static-span-acceptance-2026-10-26/focused-tests.log) |
| 全库单测 | 321/321通过 | [全量日志](verification/static-span-acceptance-2026-10-26/unit-tests.log) |
| 库构建 | ESM/CJS及声明通过 | [库日志](verification/static-span-acceptance-2026-10-26/library-build.log) |
| 宿主生产构建 | TypeScript/Vite通过，已有大包提示保留 | [宿主日志](verification/static-span-acceptance-2026-10-26/host-build.log) |

## 真实主应用验收

使用原`http://localhost:5174/`模式三入口，在独立Chromium上下文创建“[范围跟随验收] 任意静态区域”。未写用户浏览器存储、未修改原事实源文件；结束已移除夹具并关闭测试浏览器。验收卡片不承诺出现在用户当前看板列表。

| 编号 | 操作与结果 |
| --- | --- |
| SPAN-UI-01 | 从G12空白格创建区域后、全表含总计、两行高说明；预览一次，交付总量10850。 |
| SPAN-UI-02 | 保存VTable并重开G12，文字、高度、范围和锚点完整。 |
| SPAN-UI-03 | 从J16创建每行父组组前说明，仅覆盖动态列且排除总计；3个车间各一次，表尾仍一次。 |
| SPAN-UI-04 | 原生取消第一个组说明及表尾合并；模式往返、保存刷新重开，局部例外1条，表尾合并关闭但参数保留。 |
| SPAN-UI-05 | 隔离数据源新增月份/产品/车间，VTable自动扩列增行，交付10973，组说明4条、表尾1条。 |
| SPAN-UI-06 | 14条事实逆序，二维文本逐字一致。 |
| SPAN-UI-07 | 新数据后重开，旧组取消仍生效，新组正常合并；表尾合并仍关闭。设置与截图均核对。 |
| SPAN-UI-08 | 删除已取消的父组，交付6450、说明2条；恢复13条原事实后矩阵与同结构基线逐字一致。 |
| SPAN-UI-09 | 增加产品下级分组，父车间说明仍3条、表尾1条；范围起点及全宽随左侧标签增列调整，交付10850。 |
| SPAN-UI-10 | 删除下级分组后恢复原矩阵；一层及两层分组结构均测试空数据保存再恢复，与各自基线一致。 |
| SPAN-UI-11 | 同一源格连续F2改文字两次，预览/VTable仅最新文字；重开保留高度2及原取消状态。 |
| SPAN-UI-12 | 用户显式恢复表尾合并和局部例外，移除数据夹具后刷新，文字居中、交付10850。 |

12项通过，pageErrors为空。另对最终源码做一次独立“G12创建→设计态直接保存→重开”收尾核验通过。

数据变化通过仅拦截独立上下文的`/src/mockData.ts`响应替换导出数组，再刷新同一保存卡片；主要数据变化用例未重开编辑器或重存。它验证数据源新版本消费，不等同于额外验收真实服务端推送API。

证据：[交互记录](verification/static-span-acceptance-2026-10-26/browser.json)、[高级设置](verification/static-span-acceptance-2026-10-26/arbitrary-cell-span-settings.png)、[按组设置](verification/static-span-acceptance-2026-10-26/per-group-settings.png)、[取消后保留](verification/static-span-acceptance-2026-10-26/once-unmerge-rule-retained.png)、[局部例外](verification/static-span-acceptance-2026-10-26/local-unmerge-rule-retained.png)、[新增后取消不复活](verification/static-span-acceptance-2026-10-26/unmerge-after-data-added-preview.png)、[空数据](verification/static-span-acceptance-2026-10-26/data-empty-vtable.tsv)、[下级分组](verification/static-span-acceptance-2026-10-26/subgroups-vtable.tsv)、[连续编辑](verification/static-span-acceptance-2026-10-26/continuous-edits-rule-retained.png)、[最终VTable](verification/static-span-acceptance-2026-10-26/final-vtable.png)、[最终数据](verification/static-span-acceptance-2026-10-26/final-vtable.tsv)、[收尾核验](verification/static-span-acceptance-2026-10-26/final-smoke.json)、[源码指纹与汇总](verification/static-span-acceptance-2026-10-26/checks.json)。VTable截图包含复制数据后的选区高亮，非默认背景色变更。
