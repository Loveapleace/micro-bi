# 模式三明细Sheet下钻首期实施与验收

日期：2026-10-29。关联：H3-DRILL-01、[技术评估](drilldown-technical-assessment-2026-10-29.md)、[整改清单第62节](univer-implementation-issues-and-remediation.md#62-下钻首期类型时间语义与临时明细sheet2026-10-29)。

状态：**首期已实现并验收**。本轮范围为成员类型、时间分桶、数据版本修正，以及双击汇总格打开临时明细Sheet。没有实现行列层级钻入/上钻、局部展开或目标报表跳转；宿主变量H3-VAR-01继续待办。没有新增Univer透视表插件、模式二或旧配置转换。

## 1. 使用方式

1. 在现有模式三配置面板的模板设计态，双击一个维度、指标或同切片业务公式格。
2. 在其原有“设置”页启用“明细下钻”。可选择明细字段；留空展示全部字段。每页条数可选20/50/100。
3. 应用配置后切到“动态展开预览”，双击该格的展开实例，打开只读临时明细Sheet。
4. 保存报表、重开或刷新后，在正式VTable中双击同一业务格，也可通过右键“查看明细”触发。
5. 明细操作栏提供翻页、失败重试、返回主报表及关闭；同一范围重复打开会复用原页签和分页状态。

设计态双击仍按原行为编辑或打开高级配置，不触发下钻。静态内容仍只有“内容/合并与范围”，空白不弹高级配置，生成文字仍可原生编辑；没有增加通用字段信息页或独立整行样式页。

示例：[车间交付明细下钻模板](../examples/cell-reports/workshop-drilldown.json)。模板使用现有示例数据集industrial_lifecycle_orders，交付指标配置工单流水号/交付件数两列、每页20条，行总计另行启用。它是源模板JSON，不包含运行时查询结果。

## 2. 已实现的共用链路

```text
源模板drillRules
  → 展开阶段typed scope与原计算值
  → compileCellReport生成drillIndex与事实内容指纹
  → 双击/菜单解析当前实例及合并范围
  → DrillSession + 本地查询适配器
  → Univer临时工作表 / VTable临时页签
```

### 2.1 源规则与业务身份

CellTemplateDocument新增drillRules，每条包含源格、工作表、可选字段/数据源/语义身份、enabled、columns及pageSize。高级配置仅提交实际变化，并进入模式三根状态、初始恢复、元数据重生成和源历史；停用保留字段及分页参数。维度在分组/交叉布局间切换时可按语义身份继续匹配，暂时取消的源格规则保持休眠，不能因坐标被另一字段占用而串用。

首期为每个源格提供一个“查看明细”动作，不开放通用动作脚本或复杂参数映射。工作表坐标公式不提供自动明细开关，因为其来源可能跨多个切片；手工构造这种规则会被校验拒绝。

### 2.2 类型、时间与数据版本

- 维度中性路径新增typedMemberKey，同时保留现有显示/合并路径身份。下钻使用原始分组节点生成约束，区分数字1、字符串“1”、0、false、空串及null，不改变已保存的取消合并键。
- 范围继承区域筛选、完整行路径和列路径。list成员按id/_id/key定位；没有稳定主键时明确禁用精确记录追溯，不以重复显示文字冒充主键。
- formatTimeBucket真正处理IANA时区；日期时间无偏移字符串按指定时区解释，带Z/偏移或时间戳转换到指定时区。自定义天数按自然日序号划分，避免DST造成固定毫秒步长偏移。
- 查询使用同一分桶算法及完整桶定义；没有显式时区时，把生成端的实际时区固化进scope。自定义format合并跨年份成员时保留真实桶谓词，不按显示标签猜测单一时间区间。远端服务的区间翻译/历史快照协议留待实际宿主联调。
- compileCellReport默认数据版本改为事实内容指纹；可继续显式传dataRevision。drillIndex包含指纹、版本及发布修订，过期格事件不能在新版本上执行。

### 2.3 总计、格式、公式与覆盖

行总计保留行约束，列总计保留列约束，无父格总计仅保留有效筛选，不生成“字段=总计”。数字单位、显示缩放和条件替换文案不参与范围构造。

SUM/AVG/COUNT/MIN/MAX及同切片业务公式使用其实际事实范围。实例覆盖保留有效值和原计算值；两者不同时，明细栏说明覆盖与原计算值，查询仍返回原事实。工作表跨范围公式暂不自动追溯。

group-span维度合并按父成员范围命中，点击合并内部各位置结果一致。人工或同值合并包含不同scope/指标时，禁用直接明细并提示取消合并后查看各格；取消合并不删除源规则。

## 3. 双端结果与保存隔离

### 3.1 运行时明细会话

DrillSession管理加载、空结果、失败、重试、分页、页签激活、复用及关闭。最多保留5个临时页签；达到上限时关闭最早页签并取消其任务。查询使用AbortSignal、请求身份、数据修订与发布版本共同保护，晚到响应不能复活已关闭的Sheet、抢占另一页签或回写下一轮会话。

本地查询只转换当前页为Sheet单元格，范围过滤结果有容量上限的缓存。创建或翻页不重新聚合主表；主表数据版本变化会关闭旧明细，用户可在新主表上重新打开。

### 3.2 Univer动态预览

在当前已Rendered的实例中使用基础Facade创建、激活、填充及删除临时Sheet，不使用原生透视表插件。程序事务沿用现有写入标记，保持预览只读和源撤销历史；切回主Sheet保留原选区/滚动状态，切回设计态或关闭配置时清理临时Sheet。

运行时拥有的sheetId显式登记，并给临时Sheet打运行时标记。getWorkbookSnapshot、快照同步及保护入口均过滤运行时Sheet；不按工作表名称识别、隐藏或删除用户内容。主网格刷新发生在临时Sheet活动期间时，仍写回源Sheet，不把新主表数据灌入明细页。

### 3.3 VTable正式展示

展示端继续只使用VTable。ReportTableView组合基础publication与运行时页签，保存容器始终只接收基础模型；鼠标事件解析原单元格范围，保留原生复制功能，无新增顶部复制操作栏。各页签记录浏览位置，返回时恢复。

验收中发现SDK的全局pointerup会以setTimeout收尾菜单；直接或微任务中切Sheet会提前释放表实例，导致menuHandler空引用。当前动作延迟到下一任务，并校验来源表实例仍然有效。修复后全新浏览器会话连续10轮右键打开/关闭无pageerror。这个问题与此前Univer历史null(row)观察分开记录。

视觉核对另定位首行遮挡：空rowHeightConfig数组触发SDK自动行高，但冻结区前缀仍按默认26px累计；实际19px的前三行与78px前缀相差21px，首条记录被遮住。现在无显式行高时不传空配置；有显式行高时用统一回调读取中性布局，使冻结和正文一致。复验第二页QA-020实际绘制Y与逻辑Y均为79，冻结区78px，首条至第六条均可见；页签/分页更新也会刷新可见单元格缓存。

## 4. npm接入

模式三设计器使用其当前数据集完成预览查询。正式展示默认按scope.datasetId读取现有数据集注册中心。宿主已使用registerDataset注册事实时，可直接使用原展示组件；没有注册表的调用方可提供queryDrillDetails。

以下为本轮已导出的接口示例；变量与Hook应放在宿主React组件内部，records、headers和publication来自当前数据快照：

```tsx
import { useMemo } from 'react';
import { createLocalDrillQuery } from 'micro-bi/report';
import { ReportTableView } from 'micro-bi/ui';

const queryDrillDetails = useMemo(
  () => createLocalDrillQuery(() => ({ records, headers })),
  [records, headers],
);

<ReportTableView report={publication} queryDrillDetails={queryDrillDetails} />;
```

也可由DynamicDataView透传queryDrillDetails。自定义DrillQuery接收目标、范围、数据修订、指纹、页码和条数，以及AbortSignal；返回当前页records、total、可选headers及事实快照fingerprint。不能把当前页指纹当作全量快照指纹，或未经数据版本校验便回显请求指纹。查询实现要保证与主表快照一致；真实私有化服务端接口、权限及历史版本仍需在实际宿主中联调。本轮已验证本地取数和可控异步响应，不宣称真实远端接口验收。

## 5. 测试与真实入口验收

### 5.1 自动测试

新增test/drilldown.test.mjs的**DR-01～32**，使用独立事实ID及聚合预期。覆盖分组、多级路径、交叉交集、三类总计、类型成员、UTC/上海边界、DST与周起始日、自定义非连续时间组、稳定版本、关闭规则、真实条件替换、实例覆盖、数据增删/排序/空恢复、跨范围合并及取消、父分组合并内部命中、原子高级配置、临时快照过滤、分页、版本不符、过期格事件、晚响应、重试、页签上限及冻结行高契约。

最终全库**550/550通过**，无失败、跳过或取消。组件库ESM、CJS和声明构建通过；宿主TypeScript/Vite生产构建通过。执行命令为npm run build、npm run test:only及宿主npm run build；复验可直接运行npm test。保留既有宿主大包提示，没有新增SDK依赖升级。

### 5.2 浏览器结果

在隔离浏览器从真实模式三入口操作，未修改用户原浏览器存储：

| 场景 | 结果 |
| --- | --- |
| 配置与重开 | 设置页启用开关、选工单流水号/交付件数、每页20条，保存刷新重开保留；原三页签和静态边界保持 |
| 交叉格600 | 新Univer Sheet仅含WO-202608-01，交付600，scope为第一车间×8月1日 |
| 行总计4400 | 返回第一车间6条工单，范围不受某个日期列限制 |
| 活动Sheet数据刷新 | 13→新增14、逆序14、删除第一车间7、空0、恢复13；主格600→620→620→1200→空→600，旧临时Sheet关闭，拥有的临时ID回到0 |
| 源配置保持 | 数据变化期间模板JSON逐字一致，取消合并键和已有规则未被更新路径覆盖 |
| 真实分页 | 增加25条同切片测试工单，共26条；预览及VTable均两页，第二页严格为QA-020～QA-025六条 |
| 保存隔离 | 第二页活动时保存，template.sheets及publication.sheets均只有sheet-1；关闭配置后window公开API清除 |
| 返回与只读 | 回到主Sheet前后scrollState相同；重复打开复用已有Sheet；明细F2没有进入编辑 |
| 原生复制 | VTable选区Ctrl+A/C可复制当前页原有表格内容，包含QA-025及中文范围；没有产品复制栏 |
| 撤销重做 | 关闭规则→撤销恢复可下钻→重做后不创建Sheet；源历史与明细加载分开 |
| 分组/交叉切换 | 移除列时间维度后指标动作保留，分组4400在预览和VTable均返回同6条工单 |
| 生命周期 | 早期预览连续5次开关、修复后新会话10次右键开关；最终独立会话pageerror为0 |

证据：[配置](verification/drilldown-acceptance-2026-10-29/01-settings.png)、[预览Sheet](verification/drilldown-acceptance-2026-10-29/02-preview-detail.png)、[预览第二页](verification/drilldown-acceptance-2026-10-29/03-preview-page2.png)、[VTable第二页](verification/drilldown-acceptance-2026-10-29/04-vtable-page2.png)、[分组预览](verification/drilldown-acceptance-2026-10-29/05-grouped-preview.png)、[分组VTable](verification/drilldown-acceptance-2026-10-29/06-grouped-vtable.png)、[结构化检查记录](verification/drilldown-acceptance-2026-10-29/checks.json)。

### 5.3 性能样本与边界

本机Node单次合成样本：10万事实、1万分组、4个指标，发布50,007格，仅一个指标启用下钻。未启用编译约1348ms，启用约1390ms；首次本地查询约109ms，重复查询约99ms，返回10条。它是单次样本，不能当作P95或其他设备承诺。

基础publication约4.28MB；启用后约8.88MB，其中交互索引约4.61MB，1万个目标和1万个独立scope。索引不包含ruleFacts或全量事实列表，体积随启用实例数增长；大量实例下的进一步元数据压缩及真实网络传输仍需结合实际项目评估。重复查询仍会校验全量内容指纹，这是当前一致性校验的成本，后续可结合宿主可信快照版本优化。

原始数字见[检查记录中的performance](verification/drilldown-acceptance-2026-10-29/checks.json)。本轮不宣称已经完成长时内存压力测试、服务端大数据分页、完整层级展开或任意坐标公式来源追踪。

## 6. 主要代码落点

- [drillTypes](../src/report/drillTypes.ts)、[drill](../src/report/drill.ts)：源规则、typed scope、指纹、发布索引及合并解析。
- [drillSession](../src/report/drillSession.ts)：版本、分页、缓存、取消和临时页签；[runtimeSheets](../src/report/runtimeSheets.ts)隔离保存快照。
- [cellExpansionEngine](../src/report-template/cellExpansionEngine.ts)、[compileCellReport](../src/report-template/compileCellReport.ts)、[bucketing](../src/engine/bucketing.ts)：事实上下文、发布和时间语义。
- [CellAdvancedSettings](../src/cell-designer/CellAdvancedSettings.tsx)、[HybridCellDesigner](../src/cell-designer/HybridCellDesigner.tsx)、[univerDrillSheets](../src/cell-designer/univerDrillSheets.ts)：原面板配置、历史和真实预览Sheet。
- [ReportTableView](../src/ui/presentation/report/ReportTableView.tsx)、[DrillSheetBar](../src/ui/presentation/report/DrillSheetBar.tsx)：正式VTable事件及明细操作；DynamicDataView透传查询回调。
