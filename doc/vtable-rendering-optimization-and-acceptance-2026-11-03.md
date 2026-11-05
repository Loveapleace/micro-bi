# VTable 字号、缩放与实例复用优化

本轮保留 VTable 正式展示、Univer 配置和动态预览的分工，修复两端字号单位不一致，按实际屏幕比例绘制 Canvas，并使用 VTable 原生更新接口复用实例。报表配置中的字号、样式、合并和查询语义保持，不新增配置项。

## 原因与处理

| 问题 | 原因 | 本轮处理 |
| --- | --- | --- |
| 相同字号在展示态显得小 | Univer 的 `fs: 11` 是 11pt，Canvas 实际约 14.67px；VTable 的 `fontSize: 11` 是 11px | 报表字号统一保存为 pt；仅在 VTable 绘制边界乘以 `96/72` |
| 页面缩放后文字清晰度下降 | 外层页面/编辑画布通过 CSS transform 缩放，原画布像素密度未与最终显示比例协同 | 组合容器及祖先的 transform/CSS zoom，以实际比例和设备 DPR 更新原生画布密度 |
| 数据刷新反复初始化表格 | `ReportTableView` 在报表变化时 release/new ListTable，并有重复的 resize/重建格子路径 | 同一挂载期间复用 ListTable，数据使用 `setRecords`，布局使用 `updateOption`，密度使用 `setPixelRatio` |

截图场景中，1920×1080 页面缩放至 1680×945，比例为 0.875。原来的 11px 在屏幕上只剩 9.625px；修复后 11pt 对应 14.67px，再随页面缩放为约 12.83px。外层页面自适应仍会改变文字的实际显示大小，不能保证缩小后的页面与配置面板 100% 视图一样大。

## 字号与布局约定

1. `PublishedCellStyle.fontSize`、模板 `CellStyleDefinition.fontSize` 使用 Excel/Univer 的 pt，缺省为 11pt。行高、列宽和内边距继续使用 CSS px。
2. 新增 `report/fontMetrics.ts`，集中处理 pt/px 转换。设计器工具栏、保存 JSON 和重新打开均保留原字号。
3. `styleAdapter` 输出 VTable 的像素字号，11pt → 14.67px，14pt → 18.67px，18pt → 24px。常规对齐仍按原值类型判断，字体样式和条件替换不改变原数值。
4. 自动行高/换行估算使用同样的像素字号，与 VTable 单元格上下各 4px 的内边距配合。24pt 单行需要至少 40px；用户明确设置的行高优先，允许其主动裁切内容。
5. 官方导出插件把 VTable 数字字号直接交给 ExcelJS，而 ExcelJS 的单位是 pt。对本报表注册的表格，在导出回调中从合并主格的原生样式读取 px 并还原为 pt。重复处理合并格不重复缩小，其他普通 VTable 导出不受影响。

## 缩放与生命周期

`canvasViewport.ts` 统一读取和观察容器尺寸与缩放：

- 使用 DOMMatrix 组合祖先变换，计算两个轴的实际缩放；包含 CSS zoom，旋转不被误判为额外放大。
- 使用 `devicePixelRatio × max(scaleX, scaleY)` 作为画布密度，保留小数。例如 DPR=1.5、缩放=0.875 时采用 1.3125，不向整数取整。
- 密度最高为 4，限制极端放大下的画布内存消耗；非等比缩放优先保证较大的轴。
- ResizeObserver 观察容器，MutationObserver 只观察容器及祖先的 style/class；不监听 VTable 子树，避免原生渲染反复触发自身。
- 窗口/visualViewport resize、变换结束和屏幕分辨率事件合并到同一 RAF。只在尺寸或密度变化时调用必要的原生 API。
- 浏览器可能漏发仅 DPR 改变的事件，增加所有报表共享的一秒一次数值检查。它只比较 DPR，不定时读取布局；页面隐藏时跳过，恢复或聚焦时检查。最后一个观察者卸载后清除定时器及监听。
- 容器隐藏时清除可见视口缓存；重新显示时即使尺寸相同也触发 resize。组件卸载时取消 RAF、观察器和密度订阅。

这会改善绘制单位和采样密度；浏览器对小字号、非整数平移及非等比变换的最终抗锯齿仍可能与 Univer 有细微差异。

## 实例更新策略

`ReportTableRuntime` 只拥有当前视口的一份 ListTable：

| 变化 | 更新方式 | 保留内容 |
| --- | --- | --- |
| 原值、格式文本、普通格条件样式、行增删/排序 | `setRecords`，稳定列回调转向最新网格 | 实例和事件订阅；显示文字、原数值和样式同步更新 |
| 动态列、行列宽高、冻结区、合并范围及合并主格文字/样式变化 | `updateOption` | 实例不销毁，原生重建必要的布局/格子缓存 |
| 容器尺寸变化 | `resize` | 当前数据、样式和实例 |
| 页面缩放、设备 DPR 变化 | `setPixelRatio` | 不替换数据，不重新初始化表格 |
| 主报表与临时明细页切换 | 在同一实例上应用对应网格 | 按报表/Sheet 分别保存滚动位置和选区 |
| 无可见工作表或组件卸载 | `release` | 关闭页的视图缓存清理；卸载只释放一次 |

合并范围相同并不代表可以跳过布局更新：主格的文字、颜色、字号或自定义边框变化也必须刷新原生合并配置。因此布局签名包含合并后的 text/style，避免出现新数据配旧标题、旧颜色的问题。

滚动位置按 Sheet 恢复并由 VTable 约束有效范围。选区通过 `sourceCellId + bindingId` 定位，排序后跟随原业务格；身份已删除、重复或不可定位时清除选区，避免误选其他数据。异步布局恢复带更新序号和卸载校验，不把过期位置覆盖到下一次更新。

下钻双击、右键菜单及提示只注册一次，并读取当前已经应用的报表/Sheet。延迟打开明细前再检查发布修订，防止复用后使用旧查询上下文。关闭临时页不写入源模板。

## 代码位置

| 文件 | 职责 |
| --- | --- |
| `src/report/fontMetrics.ts` | 字号单位及换算 |
| `src/report-template/presentationRules.ts` | 像素字号参与换行与自动行高 |
| `src/ui/presentation/report/styleAdapter.ts` | pt → VTable px |
| `src/ui/presentation/report/canvasViewport.ts` | 尺寸、祖先缩放、共享 DPR 检测及清理 |
| `src/ui/presentation/report/reportTableRuntime.ts` | 原生实例复用、更新分流、选区和滚动恢复 |
| `src/ui/presentation/report/ReportTableView.tsx` | React 生命周期、当前报表事件和下钻 |
| `src/ui/presentation/table/exportFontMetrics.ts`、`nativeTableExport.ts` | 仅对报表表格还原导出 pt，处理合并主格 |
| `src/ui/presentation/report/exportReport.ts` | 离屏完整报表导出的字号标记 |

## 验收

基础验证为报表库 **598/598**、宿主 **166/166**。新增 VT-01～10 覆盖字号、行高、数据/样式更新、动态结构、业务选区、Sheet 滚动、密度、释放和合并导出。报表库严格类型、ESM/CJS/声明、嵌入包类型及宿主集成声明分别检查。

真实 VTable 浏览器回归使用 200 行、6 列及一个横向合并标题，随后排序、删除成员、增减列并切换明细页。10 项检查包括：

1. 11pt 对应 14.67px；18pt 对应 24px，颜色和显示文字随 `setRecords` 更新，原数值不被替换。
2. 选中的业务格在倒序后从第 3 行迁到第 202 行，滚动位置保留；删除该成员后选区清空。
3. 合并范围不变但标题更新时，新文字及其他格的格式文本生效。
4. 列数 6 → 8 → 4、主表/明细切换始终复用原实例，分别恢复滚动位置。
5. DPR=1.5、缩放 0.875 时，逻辑 900px 画布的 backing width 为 1181px，与 1.3125 倍密度的整数画布边界吻合。
6. 主动抑制 resolution change 事件后，连续 DPR=1/1.25/2/1.5 仍能恢复正确密度，验证共享兜底路径。
7. 旋转与 CSS zoom、隐藏后更新再显示均正常，卸载释放一次且不再响应缩放。无 pageerror。

完整宿主浏览器回归在开发SDK、最终生产SDK各 **14/14** 通过，覆盖独立图元查询、动态透视列、空数据、字段失配恢复、变量更新、下钻、分页导出、反复开关设计器、模板/预览切换、工程保存重开及历史变量创建。后端采用隔离内存 API，运行真实 webEditor/hwComponent/SDK，不写入真实工程。

通过原生工具栏 Facade 设置 18pt 后，动态预览保持 18，保存并发布重开后 VTable 为 24px。原生 XLSX 解析确认正文 11pt、标题 14pt，没有将渲染像素字号存回 Excel。

ESM/CJS/声明、嵌入包严格类型、宿主npm本地生成、图元集成类型、编辑与运行双端生产构建均通过。最终生产包的88个SDK资源与独立输出逐一一致，保留既有防止二次压缩的标记；Webpack仍有既有资源体积提示。

结果、截图和可复验脚本见[验收汇总](verification/vtable-rendering-2026-11-03/checks.json)、[原生运行记录](verification/vtable-rendering-2026-11-03/native-runtime-checks.json)、[开发宿主记录](verification/vtable-rendering-2026-11-03/platform-development-checks.json)和[生产SDK记录](verification/vtable-rendering-2026-11-03/platform-production-checks.json)。完整宿主脚本为 `webEditor/scripts/verify-micro-bi-platform.cjs`。截图包含[原生专项](verification/vtable-rendering-2026-11-03/optimized-canvas.png)和[真实宿主缩放场景](verification/vtable-rendering-2026-11-03/platform-scaled-canvas.png)。

本轮不套用第70节独立渲染器基准的耗时来宣称平台整体提速。可确认的是同一挂载内的刷新、排序、结构变化和缩放不再重复创建 ListTable；大数据编译与高频更新的端到端指标需按实际业务规模单独测量。

## 复验方式

```powershell
cd micro-bi
npm test
npx tsc -p embedded/tsconfig.json --noEmit
# 通过 PLAYWRIGHT_MODULE 指定可用的 Playwright，CHROME_PATH 可指定本机 Chrome。
node doc/verification/vtable-rendering-2026-11-03/native-runtime-qa.mjs
```

原生回归默认把结果写入系统临时目录，第二个参数可指定证据目录。脚本临时打包实际源代码并启动仅本机可访问的服务，结束后关闭浏览器/服务并清理本次临时构建。
