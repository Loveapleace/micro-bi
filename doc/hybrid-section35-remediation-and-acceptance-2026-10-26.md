# 模式三第35节整改与验收

日期：2026-10-26。范围：[整改清单第35节](univer-implementation-issues-and-remediation.md#35-模式三深度体验新增问题与整改要求2026-10-26)的H3D-F01～F07，优先处理3项P1。**7项已整改并复验关闭**；原面板、单元格高级设置、动态预览、保存重开及VTable入口保留。

## 结果与证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 新增专项 | 10/10通过 | [专项日志](verification/hybrid-section35-remediation-2026-10-26/focused-tests.log) |
| 全库单测 | 331/331通过，包含原范围跟随等回归 | [全量日志](verification/hybrid-section35-remediation-2026-10-26/unit-tests.log) |
| 库构建 | ESM、CJS及声明通过 | [构建日志](verification/hybrid-section35-remediation-2026-10-26/library-build.log) |
| 宿主构建 | TypeScript/Vite通过，已有大包提示保留 | [宿主日志](verification/hybrid-section35-remediation-2026-10-26/host-build.log) |
| 原入口浏览器复验 | 17/17通过；最后一项以最终源码、独立干净会话重跑全链路 | [交互记录](verification/hybrid-section35-remediation-2026-10-26/browser.json) |
| 源码与关闭状态 | 已归档 | [指纹及汇总](verification/hybrid-section35-remediation-2026-10-26/checks.json) |

主会话在多次开关/主题切换附近仍捕获2次既有`SheetsScrollRenderController2`依赖异常，继续按H3-OBS01跟踪；失败重试、快速切源及最终干净会话均无pageerror。不能据17项通过声称所有生命周期异常已消除。

## 7项修复

| 问题 | 最终修改 | 复验 |
| --- | --- | --- |
| F07/P1：受控保护误删覆盖 | 只回滚非法内容，移除按坐标删除整条高级覆盖的分支；自由编辑和高级更新也按sheetId区分坐标 | F2非法改写后单位、精度、18号字及告警保留，预览矩阵与保护前相同，非法文字不进入VTable；保存重开仍在 |
| F02/P1：源/画布历史分离 | 新增源历史快照和SDK历史适配，原生撤销/重做及Ctrl+Z/Y使用同一栈；回放恢复面板、自由格、格式、规则、锚点及行列边界 | A→B撤销回A、重做回B；行列插入/删除的一次操作一次撤回，实际边界及业务位置均恢复；保存重开不复活 |
| F05/P1：异步首次设计不加载 | 使用现有useDatasetData；区分loading/error/已加载空数据，完成加载再初始化字段和推荐配置；加载/失败阻止错误提交，并可重试 | 冷缓存首次14条、时间/数值识别正确；首次失败后重试及动态headers生效；A迟到响应不覆盖B |
| F01/P2：指标变化丢原生格式 | 指标增删/全选/清空统一先同步旧渲染画布，再改变源选择；未选择指标的配置保存在hybridConfig.retainedCells | 字号18后新增指标仍18；取消交付指标后保存重开，再选回时原字号、件及告警恢复，并未串到缺陷指标 |
| F03/P2：标题误跟业务锚点移动 | 新增可选titlePosition，以现有标题源坐标为准；结构操作独立变换标题与业务anchor；旧文档缺省仍按原偏移生成 | 第3行前插行，标题仍在第1行，业务表头3→4；撤销回3；保存重开保留 |
| F04/P2：取消后导出提示不准确 | 文案改为“取消合并后仅保留首格值” | 保留Excel取消合并语义，业务矩阵不变，关闭状态可保存重开；不自动填充标签，不恢复VTable同值自动合并 |
| F06/P2：暗色标题不可读 | 向导及报表标题、维度说明与暗色背景使用一致颜色 | 1366×768暗色下标题为rgb(240,240,240)，说明和按钮可读；业务纸面及用户样式保留 |

F04的“重复显示维度标签”在第35节中为可选后续功能，本轮没有额外引入该开关或改变已确定的Excel取消行为。

## 源配置和原生历史的实现

`hybridHistory.ts`保存最多50步源快照，内容包括面板字段/粒度/指标、聚合/格式、自由格、布局规则、保留的合并配置、禁用规则、标题与区域位置、设计工作区大小。快照克隆隔离，撤销后再编辑会舍弃旧重做分支。数据刷新、选区、复制及程序投影不产生独立用户历史；切换数据源清空旧源的历史，撤销不回滚事实数据版本。

`adapter.ts`通过当前Univer实例获取已安装版本的命令/历史服务，注册恢复源快照的mutation。网格回填产生的临时历史在投影完成后由源历史同步，原生按钮的可用状态、工具栏和快捷键共用SDK栈。回放期间禁止旧画布同步回新源，也不再把回放当新编辑。

原生格式命令开始前不触发一次不必要的旧网格重绘，结束后再同步新格式；面板变更则先同步画布，避免在用户刚改18号字时被旧11/12号投影覆盖。

### 补充修复：实际工作表边界与结构事件

最初仅恢复源坐标时，业务位置正确但实际工作表仍多一行。最终实现补充：

1. 历史同时记录工作表行列边界，设计工作区大小保存在源sheets的rowCount/columnCount，保存重开继续使用。
2. 同视图回放恢复实际行列数；跨设计/预览视图时，由当前投影重新计算尺寸，避免用设计态25行截断动态结果。
3. UniverPreview新增可选fitGridSize，本轮仅模式三启用：先清理旧网格范围，再同步真实边界；其他调用方默认保留原额外工作区行为。
4. `univerEvents.ts`只处理SDK实际发生的四种结构mutation。确认命令和外层包装不再被计为额外删除，也不再以150ms时间窗误去重两个真实连续操作。回放和程序写入不重复推进源位置。

通过左上角全选并复制整个工作表核对，非只检查表头位置：

| 操作 | 实际行数 | 实际列数 |
| --- | --- | --- |
| 初始 | 25 | 15 |
| 插行→撤销→重做 | 26→25→26 | 15 |
| 删除插入行→撤销→重做 | 25→26→25 | 15 |
| 插列→撤销→重做 | 25 | 16→15→16 |
| 删除插入列→撤销→重做 | 25 | 15→16→15 |
| 保存后刷新重开 | 25 | 15 |

证据：[行列历史计数](verification/hybrid-section35-remediation-2026-10-26/20-physical-history.json)、[最终重开属性](verification/hybrid-section35-remediation-2026-10-26/21-final-reopened-properties.png)。

## 异步加载与已有配置兼容

- rawDataset显式输入仍优先；异步源使用解析后的data与headers，加载/错误有提示及重试。
- useDatasetData按目标区分返回值：切源的首帧不会把旧源数据/headers拿来初始化新配置，旧请求完成后也不能覆盖当前目标。
- 未加载时不把未知字段永久初始化为计数；真正加载完成的空数据仍按原规则设计，不把空数据等同请求失败。
- 原指标配置、条件、父格和范围规则按稳定身份保存；临时移除的指标在retainedCells中休眠，重新选择恢复。重新勾选会按所选顺序追加，测试因此按实际C5核对，不误把C4缺陷指标认成原C4交付。
- titlePosition是编译选项，源位置仍保存在title格。旧源缺省、无标题、明细/分组/交叉报表兼容测试均通过。
- 新工作区尺寸、保留指标配置都在原源模板中保存；没有独立演示页、另一个保存接口或展示端Univer依赖。

## 17项浏览器复验

| ID | 操作及结果 |
| --- | --- |
| R35-01 | I12文字A→B，原生撤销回A、重做回B |
| R35-02 | 原生字号18后增添缺陷指标，原交付字号仍18 |
| R35-03 | 第3行前插行，标题保留第1行，表头3→4→撤销3→重做4 |
| R35-04 | 1位小数/件/告警指标被F2非法改写后，13个单位值及预览矩阵不变，高级告警仍开启 |
| R35-05 | 冷缓存源显示加载状态，加载中保存被阻止；14条及正确时间/数值字段首次预览可见 |
| R35-06 | VTable保留13个单位值、备注B及公式6，刷新后可以重开 |
| R35-07 | 取消交付指标、保存重开、再勾选并保存；新源位置C5保留18号、件和告警，C4缺陷不串用 |
| R35-08 | 取消合并提示准确，复制数值矩阵不变；Ctrl+Z/Y恢复开关，关闭状态重开仍关闭 |
| R35-09 | 1366×768暗色标题和说明可读，保存与切模式按钮可见 |
| R35-10 | 行三级/列两级、总计、既有格式/备注/公式正确；G10区域后全宽两行说明取消后保留merge=false和height=2 |
| R35-11 | 不重开编辑器/重存，13→14条新增日期、车间和工件后交付10850→11171，末尾总计列18→19 |
| R35-12 | 14条事实逆序，VTable矩阵逐字不变 |
| R35-13 | 删除首车间后8条、交付6771、总计列13；恢复后10850/列18，矩阵逐字等于基线，取消及高度保留 |
| R35-14 | 独立源首次失败，错误可见、保存阻止；重试14条成功，动态headers及正确数值指标同步 |
| R35-15 | 异步A延迟1500ms后快速切静态B；A晚到后仍是B的12条与工时/能耗指标，随后备注编辑和预览正常 |
| R35-16 | 最终源码验证实际行列边界、插删及撤销重做，单次删除只减少一行/列 |
| R35-17 | 最终源码干净会话重跑结构历史→文字历史→原生样式→增指标→单位/告警→保护→预览→直接保存→VTable→刷新重开，内容、属性及25×15边界全部保留，pageerror为空 |

关键证据：[文字撤销](verification/hybrid-section35-remediation-2026-10-26/01-history-undo.tsv)、[插行](verification/hybrid-section35-remediation-2026-10-26/03-row-insert.tsv)、[插行撤销](verification/hybrid-section35-remediation-2026-10-26/03-row-undo.tsv)、[保护后告警](verification/hybrid-section35-remediation-2026-10-26/05-protection-retained.png)、[异步首次预览](verification/hybrid-section35-remediation-2026-10-26/06-async-loaded-preview.png)、[重选后属性](verification/hybrid-section35-remediation-2026-10-26/08-reselected-reopened-properties.png)、[暗色](verification/hybrid-section35-remediation-2026-10-26/10-dark-laptop.png)、[失败](verification/hybrid-section35-remediation-2026-10-26/18-async-failure.png)、[重试](verification/hybrid-section35-remediation-2026-10-26/18-async-retry-success.png)、[快速切源](verification/hybrid-section35-remediation-2026-10-26/19-rapid-source-switch.png)、[最终VTable](verification/hybrid-section35-remediation-2026-10-26/21-final-vtable.tsv)。

## 动态数据和规则保留

复杂报表以完工月→车间→工件为行轴、投产日→工件为列轴，交付指标保留1位小数、“件”、18号字及条件告警，缺陷指标独立。G10说明跟随整个目标区域、区域后、两行高；原生取消后规则仍启用、仅merge=false。

| 源事实版本 | 交付 | 末尾总计列（1起） | 说明次数 | 备注与公式 |
| --- | --- | --- | --- | --- |
| 原13条 | 10850 | 18 | 1 | 保留 |
| 新日期/车间/工件，14条 | 11171 | 19 | 1 | 保留 |
| 14条逆序 | 11171 | 19 | 1 | 与新增矩阵逐字相同 |
| 删除首车间，8条 | 6771 | 13 | 1 | 保留 |
| 恢复13条真实源 | 10850 | 18 | 1 | 与原基线逐字相同 |

证据：[基线](verification/hybrid-section35-remediation-2026-10-26/13-complex-baseline-vtable.tsv)、[新增](verification/hybrid-section35-remediation-2026-10-26/14-data-added-vtable.tsv)、[逆序](verification/hybrid-section35-remediation-2026-10-26/15-data-reversed-vtable.tsv)、[删除](verification/hybrid-section35-remediation-2026-10-26/16-data-deleted-vtable.tsv)、[恢复](verification/hybrid-section35-remediation-2026-10-26/17-data-restored-vtable.tsv)、[重开取消规则](verification/hybrid-section35-remediation-2026-10-26/17-reopened-caption-retained.png)。

## 验收方法与边界

使用原主应用、真实模式三菜单和控件，Playwright仅负责隔离浏览器交互与截图/复制；没有读写私有React状态或伪造保存包。实际数据版本、失败和迟到响应通过独立上下文的源模块网络响应夹具模拟，原事实文件和宿主源文件未修改。数据变化用例仅刷新已有保存卡片，不靠重开设计器或重存触发更新，不声称验证真实服务端推送API。

调试中发现的初始化未完成读值、指标重选后地址变化、无条件Escape关闭模态框及下拉aria-live重复定位均已纠正，不作为通过或产品失败的证据。结构边界和全链路在最终源码干净会话重新验收；浏览器已全部关闭，夹具已移除，用户当前浏览器及其看板存储未操作。本轮没有自动提交Git。
