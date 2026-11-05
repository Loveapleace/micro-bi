# 文档导航

## 当前报表能力

| 主题 | 设计与实施 |
| --- | --- |
| 数据获取、配置和展示链路 | [当前架构](#当前架构) |
| webEditor / hwComponent实际接入 | [新报表管理、数据源、图元、变量及验收](platform-integration-and-acceptance-2026-11-02.md)；独立React18伴随包，宿主React17保持 |
| 历史变量快捷创建 | [从历史记录变量创建新报表](platform-integration-and-acceptance-2026-11-02.md#10-从历史记录变量创建新报表)；自动平台历史源与模式三明细模板，无需手动先建数据源 |
| 新报表管理布局 | [工具栏、列表和窄窗口适配](platform-integration-and-acceptance-2026-11-02.md#11-新报表管理布局) |
| Univer只读与VTable性能 | [同条件基准及应用边界](readonly-renderer-performance-comparison-2026-11-03.md)；区分初始化、更新路径与JS heap |
| VTable字号、缩放和实例复用 | [实施与验收](vtable-rendering-optimization-and-acceptance-2026-11-03.md)；pt/px边界、实际画布密度、原生增量更新及导出 |
| 模式一图表分析 | [VChart专用配置与验收](mode1-vchart-implementation-and-acceptance-2026-10-27.md)；不读取旧模式一配置 |
| 模式二下线与受控编辑 | [实施及验收](mode2-retirement-and-guided-editing-2026-10-28.md)；不读取或迁移模式二配置 |
| 模式三底层展开与合并 | [受控展开约定](cell-driven-expansion-engine-design.md)、[动态合并规格](template-dynamic-merge-design.md) |
| 模式三与多级行列维度 | [模式三整改验收](hybrid-section35-remediation-and-acceptance-2026-10-26.md)、[多轴实施验收](hybrid-multiaxis-implementation-and-acceptance-2026-10-23.md) |
| 模式三单元格高级配置 | [当前入口与页签](univer-implementation-issues-and-remediation.md#59-移除独立整行样式页签2026-10-29)；[属性归属、类型与提交约定](advanced-cell-settings-ownership-and-acceptance-2026-10-29.md) |
| 空白单元格编辑 | [双击原生输入修复](blank-cell-double-click-fix-2026-10-29.md)；空白格不弹高级配置，数据区外仍可直接编辑 |
| 配置态无法输入 | [原生输入尺寸修复与验收](native-cell-input-fix-and-acceptance-2026-11-03.md)；生成表头/指标标签、空白格、F2与中文IME |
| 左侧指标排序 | [当前仅拖拽](formula-editing-and-header-visibility-fix-2026-11-04.md)；[源配置保存与迁移原理](left-measure-order-implementation-and-acceptance-2026-11-04.md) |
| 工作表公式编辑、自定义表头 | [双击原生输入、右键结果设置及合并保护](formula-editing-and-header-visibility-fix-2026-11-04.md) |
| 预设文字编辑 | [生成表头和指标标签直接改名](generated-label-editing-implementation-and-acceptance-2026-10-29.md)；双击原生编辑，文字覆盖随身份保存 |
| 高级配置精简 | 已移除悬浮备注、字段信息和独立整行样式；当前维度/指标为设置、条件规则、动态合并，静态内容为内容/合并与范围 |
| 静态文本配置边界 | [仅保留内容、合并与范围](univer-implementation-issues-and-remediation.md#51-静态高级配置仅保留内容与范围2026-10-28)；外观使用Excel工具栏 |
| Excel工具栏样式与格式 | [保存、预览和VTable实施验收](toolbar-formatting-implementation-and-acceptance-2026-10-28.md)；不做旧结构兼容，受限操作明确隐藏或拒绝 |
| Univer生命周期 | [初始化、关闭取消与压力验收](univer-lifecycle-fix-and-acceptance-2026-10-29.md)；已修复滚动控制器注册竞态，历史null(row)另留观察 |
| 静态格跟随动态列范围 | [实施验收](static-span-implementation-and-acceptance-2026-10-26.md) |
| 模式三明细Sheet下钻 | [首期实施与验收](drilldown-detail-sheet-implementation-and-acceptance-2026-10-29.md)；双击汇总格，预览用Univer、展示用VTable，明细不进入保存包 |
| 三方API复用优化 | [实施与验收](third-party-api-reuse-implementation-and-acceptance-2026-10-30.md)；AntD页签/弹窗、VTable原生聚合行与真实xlsx、Univer公开API及TEXT公式 |
| 指标默认对齐 | [常规对齐与验收](univer-implementation-issues-and-remediation.md#64-指标默认使用excel常规对齐2026-10-30)；占位文本靠左，数值靠右，显式对齐优先 |
| 多条件、文本和样式 | [条件规则方案](conditional-rules-optimization-plan-2026-10-26.md)、[实施验收](conditional-rules-implementation-and-acceptance-2026-10-26.md) |
| React18 | [运行约定与升级实施记录](react18-implementation-and-acceptance.md) |
| 历次问题与最新约定 | [整改清单](univer-implementation-issues-and-remediation.md)；最新约定按最后章节为准 |

## 待办事项

- [ ] **H3-DRILL-01：模式三单元格交互与下钻**。首期“双击汇总格打开临时明细Sheet”及类型/时间/版本语义已[实现并验收](drilldown-detail-sheet-implementation-and-acceptance-2026-10-29.md)。预览用Univer，展示用VTable，明细不进入保存包。webEditor宿主提供完整事实，已接入前端明细查询，无需新建远端接口。目标报表跳转、行列层级钻入/上钻及局部展开仍待实施；其他不提供完整事实的宿主可另接远端查询。原范围见[第44节](univer-implementation-issues-and-remediation.md#44-模式三单元格交互与下钻待办2026-10-27)，阶段规划见[技术评估](drilldown-technical-assessment-2026-10-29.md)。
- [ ] **H3-VAR-01：模式三单元格引用宿主变量**。基础能力已随实际宿主接入：`{{address}}`、多级目录、插入、实时快照、公式及保存重开，见[实施验收](platform-integration-and-acceptance-2026-11-02.md#5-宿主变量引用)。已引用变量变化当前会重编译本报表；仅刷新引用格、依赖增量计算、高频版本调度和大型目录压力测试仍待实施。第61节保留完整需求，当前交付范围以第65节为准。

## 当前架构

1. **取数**：数据源通过注册表、缓存和异步加载入口提供事实及字段信息，数据版本更新触发重新展开；不是只保存一份静态示例数据。
2. **配置**：仅保留模式一、模式三。模式一使用ChartConfigPanel配置图表；模式三由左侧面板生成数据区，Univer编辑外观、静态内容和合并意图。高级配置按角色与值类型提供适用选项，只保存实际修改；数据区内容、父格与展开结构受控，动态预览内容只读。模式二入口、自由设计器及转换均删除。
3. **模板源**：`CellTemplateDocumentV1`保存字段/公式、父格、格式、样式规则、合并策略、范围跟随和实例覆盖。条件唯一入口是`presentationRules`，旧条件字段忽略。
4. **展开与发布**：适配器及展开器计算行列实例、事实交集、聚合、公式和合法覆盖，再解析最终文本/样式/合并；`compileCellReport`生成中性的`PublishedReport`。
5. **保存与展示**：模式一只保存ChartConfigV1，按事实重新计算并由VChart展示；模式三保存受控模板、publication和版本戳，正式表格由VTable读取publication。模式二旧条目直接忽略，不转换。原数值与显示文本分离，条件替换文案不改变计算值。

实际平台的新报表资产保存源模板或ChartConfigV1，随工程发布，运行时从数据源重算publication；不保存当时事实及展开结果。每个图元的筛选、排序、显示列和分页以唯一ID分别存localStorage。具体接入与SDK通用保存包的区别见[平台实施文档](platform-integration-and-acceptance-2026-11-02.md)。

主要代码：`src/core/datasetRegistry.ts`、`src/cell-designer/`、`src/report-template/`、`src/univer/`及`src/ui/presentation/report/`。具体类型以源码为准，前期拟议的1.0模板草案不再作为当前API手册。

展示态和编辑态均不提供顶部“复制显示内容/复制原始值”工具栏，复制产品功能后续另行设计。

## 目录职责

- `src/`：运行时源码、公共导出及必要的ambient类型声明。
- `embedded/`：面向宿主的命令式浏览器伴随包，打包内部React18/AntD5并输出独立ESM资产；不并入纯编译器入口。
- `test/`：自动回归测试；固定输入集中在`test/fixtures/`，测试辅助函数在`test/helpers/`。
- `scripts/`：构建和可执行验证脚本。旧字段浏览器复验入口为`node scripts/verify-legacy-conditional-fields.mjs`，需宿主开发服务在5174运行。
- `examples/`：可使用的报表模板JSON。
- `doc/`：现行规格、实施验收和整改总表；已被替代的独立阶段文档删除，问题ID及历史结论在总表中追溯。
- `doc/verification/`：文档引用的证据、最终browser/checks汇总，以及复验所需的数据。
- `dist/`与`node_modules/`：本机构建产物和依赖，已由Git忽略；开发和宿主依赖这些目录，不按无引用文件删除。

## 文件留存

验收仅保留必要的结果和说明，不把过程截图、空导出、重复调试快照和未引用日志全部留在项目中。临时日志写入系统临时目录；实际被文档引用的日志继续保留。文件删除前检查代码依赖、公共导出、测试输入、文档链接和内联路径，以及最终验收元数据，不能只按扩展名或日期删除。

2026-10-27清理173个文件，共10,319,149字节；其中172个为无引用的验收中间产物，1个为无调用方且未公开导出的旧SimpleDrawer组件。删除文件及原因见[清理清单](verification/project-cleanup-2026-10-27.json)。浏览器复验脚本和固定输入分别归位scripts/及test/fixtures/，未删除有效回归测试或设计方案。

随后按用户要求删除12份过时Markdown，保留有效的展开/合并规格和最新实施验收；React18有效内容整理为现行运行约定。替代去向见[Markdown清理清单](verification/markdown-cleanup-2026-10-27.json)。

2026-10-29改动区整理：归并早期高级配置说明，移除12个过时、无引用或完全重复的文件，共803,030字节；清理改动源码内20项无用声明及退役入口残留。功能源码、示例、518项测试和核心验收记录保留，按目录归类的改动文件及验证结果见[整理清单](verification/change-area-cleanup-2026-10-29.json)。
