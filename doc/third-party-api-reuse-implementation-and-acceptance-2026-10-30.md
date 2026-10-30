# 三方API复用优化与验收（2026-10-30）

## 1. 本轮结果

本轮落实三方能力排查中的可替换项：页签使用AntD Tabs、通用弹窗使用AntD Modal、普通表格总计使用VTable聚合行、Excel导出使用官方TableExportPlugin，并将Univer会话操作改为公开API。模板公式补上TEXT，复用已有numfmt格式化能力。

模式一的VChart配置、模式三的模板结构和已完成的明细Sheet下钻继续使用现有业务模型；没有加入旧配置迁移或兼容别名。工作区中此前完成的下钻实现及验收文件保留。本轮没有自动提交或推送Git。

全库 **560/560** 测试通过，比下钻首期550项新增10项。组件库ESM、CJS及声明构建通过，宿主TypeScript/Vite生产构建通过。真实浏览器已验证编辑、预览、保存、正式VTable、原生排序/筛选、弹窗及实际文件下载。

## 2. 替换范围和代码位置

| 对象 | 当前实现 | 代码 |
| --- | --- | --- |
| 报表底部Sheet页签 | AntD `Tabs type="editable-card"`；源Sheet不可关闭，临时明细可关闭 | `src/ui/presentation/report/ReportTableView.tsx` |
| 通用弹窗 | 薄封装ReportModal，仅保留主题、文案、宽度和内容区约定；Portal、焦点、ESC、遮罩和滚动锁由AntD管理 | `src/ui/components/common/ReportModal.tsx`及三个调用方 |
| 普通表格总计与排序 | 列级CUSTOM aggregation承接共享引擎的统计值，原生聚合行固定底部；真实records不再追加假总计记录 | `src/ui/presentation/table/tableSummary.ts`、`VTableView.tsx` |
| Excel文件 | 懒加载官方TableExportPlugin，生成真正的xlsx并保留原始值类型 | `src/ui/presentation/table/nativeTableExport.ts`、`tableExport.ts` |
| Univer模型与会话服务 | `FWorksheet.getSheet()`、`FWorksheet.getInject()` | `src/univer/UniverPreview.tsx`、`adapter.ts` |
| TEXT公式 | 调用共享`formatExcelValue`及numfmt校验；实际错误码与普通井号文本区分 | `src/report-template/sheetFormulaEvaluator.ts` |

已删除自定义SimpleModal及全局DataSource排序补丁文件；移除旧HTML `.xls`导出函数和旧补丁导出。`exportTableInstanceToExcel`改为返回`Promise<void>`，调用方等待完成并显示成功、取消或失败状态。调用旧导出函数的宿主代码需直接改用新入口，本项目不提供旧API别名。

## 3. 关键实现约定

### 3.1 页签只负责导航

AntD Tabs负责可访问页签、活动项、关闭图标和溢出菜单。Canvas保持在页签内容区外，页签切换调用现有报表切Sheet逻辑；关闭动作交给DrillSession。事实范围、分页、数据版本、请求取消及临时Sheet不入保存包仍由已有业务层维护。

VTableSheet本身也有多Sheet产品能力，本轮选择复用已有AntD依赖，以保留现有PublishedReport及DrillSession的数据模型，减少同时维护两套Sheet状态的成本。页签是React DOM，不是Canvas中的原生VTable页签。

### 3.2 原生聚合行承载共享统计结果

1. 共享引擎按当前筛选数据计算SUM、COUNT、加权AVG及汇总公式。
2. 各列的CUSTOM aggregation返回对应统计值，SDK维护聚合行布局与排序隔离。
3. `table.records`只包含真实行；样式回调通过公开`isAggregation`识别总计，避免合并或数据条处理总计。
4. 原生列排序使用局部比较函数，空值在升降序中均置后；多个空值之间比较为相等。
5. 普通ListTable未使用的透视维度/记录使用稳定空引用，避免筛选时因无关依赖变化而销毁实例。数据与列定义通过`setRecords`/`updateColumns`更新；SDK会在更新列时重建其聚合器。

统计口径继续复用共享引擎，尤其是加权均值和汇总公式。没有重新安装另一个FilterPlugin过滤状态：当前React筛选结果同时决定展示记录和共享统计范围，叠加第二套过滤会使两者可能不一致。

### 3.3 按需导出真实xlsx

首次导出才加载`nativeTableExport`和官方插件/ExcelJS。插件通过公开pluginManager注册，延迟注册后只运行该插件的初始化生命周期，不重新派发表格全局initialized事件。资源释放交给表格插件管理器。

- 导出当前ListTable/PivotTable的二维布局、排序、SDK合并和可导出的样式；保留数值、0、布尔值false、空字符串和null的语义。
- 文本编号`00123`、日期文本`2026-08`使用文本单元格；`=1+1`保留普通字符串，不产生Excel公式。数值公式导出的是当前计算结果，文件不携带业务公式执行环境。
- 不承诺完整复刻自定义Canvas图形、图表、图标或数据条；这些类型按值导出。
- 按钮显示加载状态并防止重复提交。导出期间records/列定义引用、行数或排序发生变化，取消过期文件；表格关闭时返回可理解的取消提示，避免暴露SDK内部空模型错误。
- 原生sortState可能包含循环引用的指针事件，仅提取field/order或透视维度排序描述用于快照比较。
- 轻量CSV与剪贴板纯工具保留，导出xlsx不再拼HTML。模式三本轮没有新增顶部导出或复制操作栏。

对外入口示例：

```ts
import { exportTableInstanceToExcel } from 'micro-bi/ui';

await exportTableInstanceToExcel(tableInstance, '生产报表.xlsx');
```

### 3.4 公共API与纯编译边界

Univer会话就绪后通过活动Sheet的`getInject()`取得服务；预览回填通过`getSheet()`取得公开Worksheet模型，不再读取保护字段`_worksheet`。合并元数据回填仍保留被覆盖格内容，不能直接换成会清空覆盖格的普通merge命令。

编辑器启动阶段尚无活动Workbook，底层引导及菜单限制所需的`univer.__getInjector()`仍保留在适配器内；本轮没有声称移除了所有底层DI访问。源配置事务继续配合原生UndoRedo服务，动态预览回填不污染用户源历史。

TEXT复用现有numfmt 4.1.1，包括小数、千分位、百分比、补零及日期格式。错误结果正常传播，空格式不吞掉除零错误；`#012`、`#tag`这种普通文本不会因为井号开头就被当成错误。

模板设计态为显示表达式会将公式投影成源文字；模板源仍保留sheet-formula，动态预览及发布阶段计算真实值。没有将整个公式计算链改为Univer：纯TypeScript编译和展示态仍能独立于Univer运行。

## 4. 依赖和宿主接入

实际验收版本：React/ReactDOM 18.3.1、AntD 5.29.3、VTable 1.26.8、vtable-plugins 1.26.8、Univer 1.1.0、numfmt 4.1.1。

```bash
npm install antd@5.29.3 @visactor/vtable@1.26.8 @visactor/vtable-plugins@1.26.8
```

UI的AntD peer范围为`>=5.29.3 <6`；VTable及可选导出插件为`>=1.26.8 <2`，宿主应保持SDK和插件版本一致。仅使用数据引擎无需安装导出插件。Modal使用当前`destroyOnHidden` API，调用方已同步。

宿主`dynamic-data-test/vite.config.ts`为AntD、图标、VTable、插件、React和Univer配置dedupe。开发期预优化导出插件及Univer入口，避免首次懒加载时Vite重新发现依赖并整页刷新、丢失正在编辑的弹窗；预优化服务器缓存不等于浏览器首屏加载插件。生产manifest也确认nativeTableExport和插件属于动态入口。

本轮为新引入导出依赖修正传递依赖约束：lodash 4.18.1、minimist 1.2.8、ExcelJS下的uuid 11.1.1；宿主另约束source-map-js 1.2.2。主库`npm audit`为0。宿主仍有Vite/esbuild开发工具链的2项报告（1 high、1 moderate），npm建议的修复涉及Vite 8跨主版本升级，留待单独评估，不使用force升级。

库的overrides不会替消费项目覆盖依赖，真实宿主安装后仍需自行核对锁文件与审计结果。本轮两处package.json及锁文件均已更新。

## 5. 自动测试和浏览器验收

新增`test/third-party-reuse.test.mjs`，原表格测试改为断言SDK原生聚合行，不再通过安装补丁来证明总计隔离。

| 用例 | 结果 |
| --- | --- |
| REUSE-01 | 导入UI前后DataSource.prototype.sort为同一函数，未修改SDK全局原型 |
| REUSE-02～04 | TEXT数值/日期/补零/百分比、非法格式、空格式、错误传播、普通井号文字和IFERROR通过 |
| REUSE-05 | TEXT经过模板编译及publication，原值和显示文字均为`1,234.50` |
| REUSE-06 | xlsx单元格回调保留0、false、空字符串、文本编号、日期文本、普通公式样式字符串及null |
| REUSE-07 | SDK原生升降序不把总计混入records；聚合器在更新列后刷新，空值排序稳定 |
| REUSE-08～10 | 循环事件不影响导出，异步期间数据变化和关闭表格会取消过期结果 |

真实浏览器以5174宿主、隔离存储执行，未覆盖用户当前看板配置。普通表格验收挂载实际VTableView组件及共享transformData，不是另写导出演示实现。

| 入口操作 | 最终结果 |
| --- | --- |
| 原生表头升/降序 | 交付数分别为15/20/50和50/20/15；records始终3条，总计85留在底部 |
| 搜索1号车间并清空 | 同一VTable实例，筛选后1条、总计20、缺陷率0.1；恢复3条 |
| 实际菜单下载ListTable xlsx | ZIP签名50/4B/03/04；`00123`及`2026-08`为字符串，false为布尔值，`=1+1`为普通字符串，总计85、汇总缺陷率0.117647 |
| 实际菜单下载PivotTable xlsx | 6行7列，多级表头合并B1:D1、E1:G1、A1:A2；交付总计85、缺陷总计10、汇总缺陷率0.117647 |
| 排序/关闭打断导出 | 分别提示数据或排序已变化、表格已关闭，未产生页面异常；关闭场景使用1000行实际表格 |
| 模式一新建公式指标 | 嵌套弹窗可编辑并保存`[output_qty] * 2`；关闭子弹窗后父配置仍在 |
| 快速ESC关闭子弹窗 | 修正初验中父弹窗一并退出的问题，最终只关闭子弹窗；共享AntD并取消子层入场动画，避免焦点尚未迁入时ESC落到父层 |
| 模式三F2输入TEXT及SUM | 预览与保存后的publication分别得到`1,234.50`和3；源公式保留 |
| 模式三撤销/重做及反复开关 | 源规则保留；3轮开关配置/预览后Univer API正确清除，无pageerror |
| 正式表格原生Tabs | 主表不可关闭，明细可关闭；关闭活动明细返回主表 |
| 明细活动时保存并重新打开 | 模板和基础publication都只含源Sheet，临时明细不进入保存包；下钻配置保留 |

截图中普通VTableView保留其现有格式化规则，缺陷率原值0.117647会按现有显示逻辑呈现0.118；导出保留原值。固定文本编号列被既有字段推断判为数值时仍可能被统计（截图中的code总计1368），本轮没有更改这项字段推断/统计策略。

生产构建保留大型SDK分包告警，未通过提高告警阈值掩盖体积。懒加载已验证，整体包体和Vite主版本升级可另行优化。

## 6. 复验和证据

```bash
# micro-bi
npm run build
npm run test:only

# dynamic-data-test
npm run build
```

- [最终检查记录、版本、源码及证据哈希](verification/third-party-reuse-2026-10-30/checks.json)
- [正式报表原生Tabs](verification/third-party-reuse-2026-10-30/01-native-tabs.png)
- [原生公式弹窗](verification/third-party-reuse-2026-10-30/02-native-formula-modal.png)
- [实际VTableView原生总计](verification/third-party-reuse-2026-10-30/03-native-summary.png)
- [实际ListTable导出文件](verification/third-party-reuse-2026-10-30/native-export.xlsx)
- [实际PivotTable导出文件](verification/third-party-reuse-2026-10-30/native-pivot-export.xlsx)

官方能力参考：[插件列表](https://visactor.io/vtable/guide/plugin/usage)、[导出插件及旧导出包说明](https://visactor.io/vtable/guide/export/excel)、[AntD Tabs](https://ant.design/components/tabs/)、[AntD Modal](https://ant.design/components/modal/)、[Univer FWorksheet公开API](https://docs.univer.ai/en-US/reference/facade/worksheet)。实现同时以本地安装版本的声明与运行结果为准。
