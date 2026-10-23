# 模式三新增维度未同步到Excel的排查与修复建议

> 本文保留首次定位时的历史结果。后续已完成第31节整改，最新实现与验收见[多级维度整改验收](hybrid-multiaxis-implementation-and-acceptance-2026-10-23.md)及清单第32节；静态文本区域满宽需求另见清单第33节。

日期：2026-10-23。对象：原主应用模式三，尤其是“列时间周期=计划投产时间/月，列分类维度新增承制车间”的组合。本轮执行源码分析、7组适配器诊断和独立浏览器复现，没有修改业务源码，也未重新运行全库测试或构建。

## 已确认的结论

截图对应的问题已复现。**主要遗漏发生在面板配置转模板的适配器，新增维度没有成为模板字段格。** 左侧选择状态已变化，右侧最终收到的模板仍只有一个列维度，动态预览和VTable沿用这个不完整模板。保存后再打开，新增的列分类选择也会消失。

这不是仅凭截图推测，也不能靠刷新画布补出缺失的字段。独立浏览器中进行了以下对照：

1. 默认行分类为工单流水号，列时间为计划投产时间/月，保留两个默认指标，模板9格。
2. 添加列分类“承制车间”，左侧出现选中标签；模板仍9格，复制出来的设计区域与添加前逐字一致，没有`{承制车间 →}`。
3. 切换动态预览，仍只有`2026-08`这一时间列轴，没有车间层级。
4. 清空列时间字段，右侧立即出现`{承制车间 →}`，表明字段存在且画布刷新链路能工作。
5. 恢复时间加车间的组合并保存，VTable仍为单时间列轴；重开配置，车间选中标签消失。

证据：[浏览器记录](verification/hybrid-dimension-sync-2026-10-23/browser-analysis.json)、[选择前模板](verification/hybrid-dimension-sync-2026-10-23/design-before.tsv)、[选择后模板](verification/hybrid-dimension-sync-2026-10-23/design-after-add.tsv)、[截图复现](verification/hybrid-dimension-sync-2026-10-23/time-plus-category-missing.png)、[清空时间的对照](verification/hybrid-dimension-sync-2026-10-23/category-only-control.png)、[重开丢失选择](verification/hybrid-dimension-sync-2026-10-23/reopened-lost-category.png)。本轮浏览器没有捕获pageerror。

## 逐层定位

| 层级 | 当前实现与判断 | 排查落点 |
| --- | --- | --- |
| 数据源及字段绑定 | `workshop`在字段选项中存在，单独作为列分类时正常生成字段格；本例没有证据表明是取数缺字段。真正缺少的是模板中的`content.fieldKey = workshop`及对应列轴父子关系。 | `HybridCellDesigner.tsx`的fieldItems、transformConfig；模板`cells`中的fieldKey、role、timeBucket。 |
| React状态 | Select使用`value={colCategories}`和`onChange={setColCategories}`；编译useMemo包含colCategories、colTimeField等依赖，transformConfig也传入完整columnCategories数组。截图中的选中标签、实际受控Select行为和源码相符。 | `HybridCellDesigner.tsx:486～535、1532～1544`。不要将setState异步本身当作已确认根因。 |
| 模板编译 | **确认根因。** `compilePivotTemplate`通过OR选择单个字段，并且只读取分类数组第0项。时间存在时所有列分类都被忽略；没有时间时也只保留第一个列分类。 | `panelToTemplateAdapter.ts:90～106、119～120`。 |
| 模板合成及网格 | `mergeHybridCells`合成适配器生成格与用户覆盖；设计态通过遍历currentTemplate.cells生成网格，不会凭空创建适配器未生成的轴。 | `hybridTemplateState.ts`；`HybridCellDesigner.tsx:546～642、648～765`。 |
| Univer渲染 | initialGrid变化会触发增量更新并写入格子；本例“清空时间后立即出现车间”是刷新有效的对照。设计网格最少25行15列，尺寸不增加不等于字段没有更新，应检查cells内容。设计态bindings为空是当前占位符实现，不能单凭这一点判为根因。 | `UniverPreview.tsx:190～486`，重点检查格子内容、坐标、合并区与onGridApplied。 |
| 保存和重开 | 当前hybridConfig只明确保存总计选项；维度从模板字段格反解。被适配器遗漏的车间不会写入模板，重开也就无法恢复。 | `types.ts`中的hybridConfig；`HybridCellDesigner.tsx:259～306`及宿主HybridReportEditModal保存包。 |

根因代码：

```ts
const colTime = config.dimensions?.columnTimeBucket;
const colCat = config.dimensions?.columnCategories?.[0];
const colDimKey = colTime?.field || colCat || options.defaultColDim || 'col_dim';
```

这里实现的是“选出一个列字段”，无法表达“时间轴下再按车间分层”。把OR的顺序颠倒也只能改变被保留的字段，仍不能生成两个层级。

同类遗漏也存在于其他组合：透视模式的行轴只取`categories[0]`，存在分类时行时间被忽略；普通分组模板只处理主、次两级，第三个分类会被忽略。左侧的多选能力和模板生成能力因此不一致。

## 适配器诊断结果

直接用TypeScript transpileModule执行当前适配器源码，避免以过期dist代替现版本；检查所选字段是否全部成为对应轴字段格。结果是7组中2组符合完整维度契约、5组存在遗漏。这里的失败表示发现当前问题，不是整改后验收结果。

| 编号 | 输入 | 实际生成 | 结果 |
| --- | --- | --- | --- |
| DIM-01 | 一行分类+一列时间 | 两个轴均完整 | 对照通过 |
| DIM-02 | 列时间+列分类workshop | 只有时间，无workshop | 失败，截图同例 |
| DIM-03 | 无列时间，只有workshop列分类 | 正常生成workshop | 对照通过 |
| DIM-04 | 无列时间，workshop+part_name列分类 | 只生成workshop | 失败 |
| DIM-05 | 透视模式workshop+part_name行分类 | 只生成workshop行轴 | 失败 |
| DIM-06 | 透视模式行时间+workshop行分类 | 行时间被忽略 | 失败 |
| DIM-07 | 普通分组模式三个行分类 | 只生成前两个 | 失败 |

详细输入、输出、缺失字段及源码SHA256见[适配器诊断](verification/hybrid-dimension-sync-2026-10-23/adapter-analysis.json)。上轮第30节覆盖单行维度、单时间列的总计和格式等功能，没有覆盖本轮这些多维组合；原263项单测通过不能证明这些组合已支持。

## 具体排查步骤

以后遇到相似现象，按以下顺序比较每一层的维度描述；在第一处发生差异的边界修复。

1. **核对字段契约。** 比较数据集元数据key、记录key、Select value、模板fieldKey，避免label代替key或数据源切换后沿用旧字段。本例应看到`plan_start_time`和`workshop`均存在。
2. **核对状态与输入。** 在选择事件和编译入口查看colTimeField、colCategories、transformConfig.dimensions，确认新数组及完整选项已进入编译。日志记录字段key和维度结构即可，无须输出整批事实数据。
3. **核对生成格。** 编译前后的列维度描述应分别为`[plan_start_time]`、`[plan_start_time, workshop]`，同时核对role和timeBucket，不能只检查总格数或第一个find结果。本例就在这里缺少workshop，应先修此层。
4. **核对合成及布局。** 如果生成格正确而currentTemplate/currentGrid不正确，检查覆盖是否按稳定身份合成、是否有坐标碰撞、旧owner、错误父格、合并区域遮挡，以及表头深度和指标起点是否仍写死。
5. **核对实际刷新。** 如果grid已含workshop而画布没有，再检查initialGrid引用、effect分支、worksheet就绪状态、Range写入及onGridApplied。用实际选区复制核对模型文本，区分未生成、未写入和画布未重绘。
6. **核对发布往返。** 保存后比较模板、publication和VTable，再刷新重开比较左侧配置。不能仅以画布出现标签或保存提示成功作为完成标准。

## 建议的完整修复

### 1. 把单字段选择改为有序轴定义

在适配器前建立统一的normalizeHybridAxes，将行时间与全部行分类、列时间与全部列分类转换成两个有序数组。时间先于分类可作为默认规则，界面明确显示层级顺序；如果开放调整顺序，应保存实际顺序。

```ts
interface HybridAxisDefinition {
  id: string; // 稳定轴身份，不能仅用数组下标或格坐标
  fieldKey: string;
  kind: 'time' | 'category';
  timeBucket?: CellTimeBucketConfig;
}

// 合并所有有效选择；不再用 || 或 [0] 截断。
const rowAxes = normalizeAxes(rowTime, rowCategories);
const columnAxes = normalizeAxes(columnTime, columnCategories);
```

规范化时校验字段存在性、重复配置、时间粒度及顺序；同字段的原值轴与时间分桶轴不能仅凭fieldKey合并，需明确允许规则或提示冲突。没有支持的组合应给出明确错误，不能接受选择后静默忽略。

### 2. 生成完整父格链与表头布局

对每个行轴创建row-dimension驱动格，子轴的row父格显式指向前一轴；对每个列轴创建column-dimension驱动格，子轴的column父格显式指向前一轴。跨轴不继承使用`'none'`，不要用会被自动推断的null。

截图例子的列轴应为：

```text
计划投产月 → 承制车间 → 指标交叉值
```

指标绑定最末级行、列驱动，依靠完整路径和事实交集求值。`cellExpansionEngine.ts`已有buildRowNodes/buildColNodes递归入口，但仍需专项验证多级表头、原型跨度、父级覆盖和事实作用域，不能认为仅补几个父格ID就已完成。

布局起点应由维度数量计算。例如在当前指标纵向排列方式下，列轴深度决定表头行数，行轴数量决定左侧标签列数，指标标签列跟在所有行标签后，数据区起点随之移动。同步调整标题、宽高、冻结区和总计位置；为每级列轴生成水平方向的分组覆盖策略，为行轴生成竖向策略。新增格与自由备注发生占位冲突时，应诊断冲突，不能静默覆盖。

### 3. 保留现有编辑和同步管道

维度结构改变前提交正在进行的编辑并读取设计快照；通过panelOwner和稳定轴身份迁移格式、条件规则、备注和合并配置。继续按实际已应用grid解释快照，提交新布局后清除旧投影。不要用固定setTimeout、forceUpdate或频繁变更Univer组件key代替完整编译；这无法补出被丢弃的字段，还会影响已有编辑状态。

### 4. 保存完整设计意图并校验一致性

建议将hybridConfig升级为可迁移的版本2，包含有序rowAxes、columnAxes及现有showRowTotals。以明确的面板意图生成模板；重开优先恢复保存意图，旧版模板仍保留从字段格及父链反解的兼容路径，顺序按父链恢复，不能依赖cells数组偶然顺序。

保存前核对“选择的轴描述”与“实际编译轴描述”完全对应，包括角色、字段、粒度和父链。发现缺失或未支持组合时阻止发布并标出遗漏维度。保留配置的同时仍必须修复编译器；仅保存原选择不能让错误的VTable结果变正确。

### 5. 补足针对组合的测试

| 用例 | 关闭标准 |
| --- | --- |
| 时间列+车间列分类 | 设计态有两个列轴格；动态预览出现月→车间层级；按事实交集计算，两个指标不丢失。 |
| 两个/三个列分类，或列时间+两个分类 | 所有层级都生成，父链正确，维度顺序与界面一致；不能只断言第一个字段存在。 |
| 两个/三个行分类，行时间+行分类 | 透视和分组路径均不截断；分组标签跨度及指标对齐正确。 |
| 选中、删除、清空时间、调整顺序 | 模板及时增删、旧字段清干净、对应合法覆盖保留；新增布局冲突显式提示。 |
| 数据新增/删除、输入逆序、某月份新增车间或移除车间 | 实例按完整路径定位，聚合正确；样式、覆盖及合并不按旧坐标串用。 |
| 开关同类项合并及行总计 | 多级父标签覆盖正确；取消合并规则仍保留；总计一次出现在全部叶子列后，按事实汇总。 |
| 保存、刷新、重开、再保存 | 左侧有序维度完整，模板轴完整，VTable文本/样式/合并与预览一致；未编辑重存不变。 |

前述诊断5组失败全部修复后，再跑第30节的12项专项与全库测试、库/宿主构建，并补原入口真实UI往返。修复状态以实际测试结果更新，本报告不将建议视为已实现。
