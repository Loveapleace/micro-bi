# 模式三左侧指标排序实施与验收

后续入口调整见[仅拖拽排序、公式编辑与自定义表头修复](formula-editing-and-header-visibility-fix-2026-11-04.md)。上下按钮及下文对应截图/验收为第73节交付时的记录，当前仅保留拖拽。

按照“只在左侧指标处做排序”的要求，模式三的已选指标支持拖拽、上移和下移。排序修改受控源配置，由现有编译链同步模板设计、动态预览和VTable；画布继续使用现有编辑边界。

## 操作

- 已选指标按报表顺序排在列表前部，未选字段按数据源顺序列在后面。
- 拖动指标前方的手柄调整顺序，插入线显示落点；也可以使用右侧上下箭头，按钮支持键盘操作。
- 首项上移、末项下移不可用。拖回原位置或放到无效目标不会产生排序。
- 新勾选字段追加到已有顺序末尾；取消勾选只移除该项。“全选”保留当前顺序，再追加其他字段。
- 聚合和数字格式继续在已选指标下方设置。

例如原顺序 `spindle_speed_rpm → feed_rate_mm_min → timestamp`，将timestamp拖到第一项后，两端表头及字段顺序变为 `timestamp → spindle_speed_rpm → feed_rate_mm_min`。

| 报表 | 排序结果 |
| --- | --- |
| 明细表 | 调整字段列顺序，并由编译器重新确定明细主驱动和父格链 |
| 分组报表 | 调整既有分组原型内的指标顺序，所有分组统一应用 |
| 双向交叉表 | 调整每个行列交叉块内的指标顺序，行列维度及成员顺序按原配置生成 |

## 状态与保存

`selectedMeasures` 是指标顺序来源。`measureOrder.ts` 提供按字段身份移动，以及勾选结果与显式顺序合并的方法，避免AntD Checkbox.Group按组件注册顺序返回值后重置排序。

拖拽和箭头调用同一个处理函数，通过既有源配置历史完成一次原子变更。模板依然由 `compilePanelToCellTemplate` 生成。保存时受控单元格数组具有最新顺序；重开按受控字段顺序恢复并按字段key去重，不新增一份相互独立的展示列顺序。

排序后旧画布暂时不能回采为新源，直到新网格应用完成，防止旧坐标的快照覆盖刚迁移的公式或布局。撤销和重做恢复整份源状态，包括顺序、关联公式和尺寸。

## 配置保留

| 配置 | 处理 |
| --- | --- |
| 字体、颜色、格式、条件规则及显示文本替换 | 继续按稳定单元格/指标身份保存，随指标移动 |
| 已修改的表头及指标名称 | 保留literalOverride及原指标身份 |
| 取消合并及动态合并规则 | 保留原规则、取消意图和目标身份，按新原型重新展开 |
| 下钻规则 | 保留源单元格身份及查询列，由新发布坐标生成入口 |
| 自定义指标列宽、指标行高 | 将受影响的尺寸索引迁移到该指标的新列/行 |
| 标题、静态内容及维度配置 | 继续使用原有位置与动态展开规则 |

同时修正了布局覆盖的恢复/采集逻辑：不能仅因自定义宽高与生成规则具有同一类型或坐标就把它丢弃。现在比较完整布局意图，包括索引和实际尺寸，保存重开后仍能恢复用户设置。

## 单元格公式

存在工作表公式时，以同一事实快照展开排序前后的网格，按源单元格及其成员出现次序建立坐标迁移，再改写公式引用。复用现有公式求值器的词法分析，保留引号内文本、函数名和绝对引用标记。

例如明细表的 `=A4/B4` 在A指标移到C列、B指标移到A列后变为 `=C4/A4`。交叉表同时处理各个分组中的重复实例，避免只改模板第一组。

连续范围只有在迁移后仍是同等大小的矩形时才重定位。若 `SUM(A4:B4)` 的两个指标被排成不连续的A、C列，排序会明确提示并保持原顺序，防止把中间另一个指标加入计算。可先将公式调整为独立引用再排序。

迁移范围为当前支持的本表A1引用。数据增删或查询排序引起的记录位置变化仍沿用现有坐标公式语义；本功能不新增按记录身份持续绑定A1公式的机制。

## 验收中的生命周期修复

反复关闭包含工作表公式的设计器时，复现了 `[LocaleService]: Locale not initialized`。调用栈位于Univer 1.1公式进度控制器：延迟一秒的进度定时器在语言服务释放后继续执行。

`univer/adapter.ts` 在实例开始销毁时，先通过SDK公开命令同步停止该实例的计算，并发送本地STOP_EXECUTION终态，清理进度定时器，再关闭会话和释放Univer。不修改node_modules，不延长已关闭编辑器的可写时间。

宿主回归还复现了快速DPR/缩放往返后残留旧画布密度的问题：视口观察器已读到中间DPR，但共享DPR缓存尚未更新，回到原DPR时被误判为未变化。现在每次视口测量同步共享DPR状态，仍保留原来的一秒数值兜底，不增加布局轮询。

## 验收范围

新增MO专项验证勾选/全选顺序、三种报表的身份和条件保留、尺寸迁移、布局恢复、A1及范围引用、交叉表重复成员引用，以及不可连续范围的原子拒绝。

真实宿主脚本使用独立内存API和实际webEditor/hwComponent/SDK，分别创建明细、分组和双向交叉模板，验证：

1. 双向拖拽、上下按钮及键盘触发；模板同步。
2. 原生撤销/重做恢复顺序及公式。
3. 勾选新字段、取消及全选不重置已有顺序。
4. 原字号/颜色、数字格式、自定义宽高保留。
5. 动态预览内继续通过左侧排序，条件显示文本不改变原数值或公式结果。
6. 保存及VTable展示保留重命名、规则和取消合并意图；明细表还覆盖分页后的公式位置。
7. 保存重开、工程发布重载及数据增删、逆序、空数据恢复；新增分组与透视日期列。
8. 分组和交叉表的下钻仍指向排序后的正确指标。

结果记录位于[验证目录](verification/left-measure-order-2026-11-04/checks.json)。完整宿主回归和原生输入回归继续复验此前能力。

最终结果：主库 **608/608**（含MO专项10项），三类报表真实交互 **32/32**，完整宿主浏览器 **14/14**，真实输入/IME **12/12**，原生视口及生命周期 **11/11**，均无pageerror。ESM/CJS/声明、嵌入包严格类型及生产SDK构建通过。宿主源码未变，本轮重新生成SDK并由现有开发构建加载；未重复构建宿主双端生产主包。

效果见[明细表](verification/left-measure-order-2026-11-04/detail.png)、[分组表](verification/left-measure-order-2026-11-04/grouped.png)和[交叉表](verification/left-measure-order-2026-11-04/pivot.png)。

## 代码与复验

| 文件 | 内容 |
| --- | --- |
| `src/cell-designer/HybridCellDesigner.tsx` | 左侧排序交互、原子历史及编译同步 |
| `src/cell-designer/measureOrder.ts` | 显式顺序、勾选合并、尺寸及公式迁移 |
| `src/cell-designer/hybridTemplateState.ts` | 布局覆盖的完整意图比较 |
| `src/report-template/sheetFormulaEvaluator.ts` | 复用词法分析改写本表引用 |
| `src/univer/adapter.ts` | 关闭前停止公式进度并清理延迟状态 |
| `test/measure-order.test.mjs` | MO专项测试 |
| `webEditor/scripts/verify-micro-bi-measure-order.cjs` | 三种报表的真实宿主验收 |

```powershell
cd micro-bi
npm test
npx tsc -p embedded/tsconfig.json --noEmit
cd ../webEditor
npm run prepare:micro-bi
# 设置PLAYWRIGHT_MODULE、CHROME_PATH及MICRO_BI_HOST_URL后执行。
node scripts/verify-micro-bi-measure-order.cjs
node scripts/verify-micro-bi-platform.cjs
node scripts/verify-micro-bi-cell-input.cjs
```

排序脚本支持 `MICRO_BI_ORDER_QA_OUTPUT` 输出结果、`MICRO_BI_ORDER_SCREENSHOT_DIR` 保存三类预览截图，`MICRO_BI_SDK_ASSET_DIR` 可指定生产SDK目录。fixture覆盖全部平台写接口，不写入真实工程。
