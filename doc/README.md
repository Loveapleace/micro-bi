# 文档导航

## 当前报表能力

| 主题 | 设计与实施 |
| --- | --- |
| 数据获取、配置和展示链路 | [当前架构](#当前架构) |
| 原面板与单元格驱动配置 | [展开规格](cell-driven-expansion-engine-design.md)、[动态合并规格](template-dynamic-merge-design.md) |
| 模式三与多级行列维度 | [模式三整改验收](hybrid-section35-remediation-and-acceptance-2026-10-26.md)、[多轴实施验收](hybrid-multiaxis-implementation-and-acceptance-2026-10-23.md) |
| 静态格跟随动态列范围 | [实施验收](static-span-implementation-and-acceptance-2026-10-26.md) |
| 多条件、文本和样式 | [条件规则方案](conditional-rules-optimization-plan-2026-10-26.md)、[实施验收](conditional-rules-implementation-and-acceptance-2026-10-26.md) |
| React18 | [运行约定与升级实施记录](react18-implementation-and-acceptance.md) |
| 历次问题与最新约定 | [整改清单](univer-implementation-issues-and-remediation.md)；最新约定按最后章节为准 |

## 当前架构

1. **取数**：数据源通过注册表、缓存和异步加载入口提供事实及字段信息，数据版本更新触发重新展开；不是只保存一份静态示例数据。
2. **配置**：原字段面板保留；单元格模式按位置、扩展方向与父格绑定；模式三由面板生成模板，再由Univer编辑。模板设计和动态预览是同一源的两种投影。
3. **模板源**：`CellTemplateDocumentV1`保存字段/公式、父格、格式、样式规则、合并策略、范围跟随和实例覆盖。条件唯一入口是`presentationRules`，旧条件字段忽略。
4. **展开与发布**：适配器及展开器计算行列实例、事实交集、聚合、公式和合法覆盖，再解析最终文本/样式/合并；`compileCellReport`生成中性的`PublishedReport`。
5. **保存与展示**：宿主保存模板、publication和版本戳，重开恢复源配置；正式表格由VTable读取publication，不需要Univer。原数值与显示文本分离，条件替换文案不改变计算值。

主要代码：`src/core/datasetRegistry.ts`、`src/cell-designer/`、`src/report-template/`、`src/univer/`及`src/ui/presentation/report/`。具体类型以源码为准，前期拟议的1.0模板草案不再作为当前API手册。

展示态和编辑态均不提供顶部“复制显示内容/复制原始值”工具栏，复制产品功能后续另行设计。

## 目录职责

- `src/`：运行时源码、公共导出及必要的ambient类型声明。
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
