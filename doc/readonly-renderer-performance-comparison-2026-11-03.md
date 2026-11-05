# Univer只读与VTable的性能对比

日期：2026-11-03。结论用于当前报表图元的技术选择，不作为框架的通用性能排名。

**在本次测试配置下，VTable的初始化和多实例创建更轻；刷新性能随更新接口和数据规模变化。Univer只读适合重视Excel呈现一致性的场景，不能仅凭隐藏编辑UI视为轻量渲染器。**

## 测量范围

- Univer1.1.0，使用SheetsCorePreset，隐藏header、toolbar、formulaBar、footer及右键菜单，工作簿模式viewer。
- VTable1.26.8，使用ListTable，隐藏业务表头，消费相同已计算的数值和文本。
- Windows、AMD Ryzen 9 7945HX（16核32线程）、Chrome155.0.8059.85无头模式。
- DPR1，总绘制区域1000×600；四实例时每个500×300，依次创建。
- 字体统一为14px Arial；Univer设置10.5pt，VTable设置14px。行高28px、列宽100px。
- 无公式、无合并、无复杂条件规则；两端使用各自默认的对齐/网格呈现。每组3个独立浏览器样本，取中位数。
- 原始数据使用生成的DEV编号、状态文本和数值。全部在临时页面中运行，不读取或写入真实平台。

首屏计时从引擎模块加载完成后开始，包括输入模型转换、实例构造、生命周期就绪和两个requestAnimationFrame。业务取数、聚合及模板展开不在计时区间。代码导入单独记录；浏览器滚动帧率及真实终端尚未测量。

## 初始化至首帧

| 场景 | VTable | Univer只读 |
| --- | ---: | ---: |
| 单实例50行×20列，1000格 | 90ms | 438ms |
| 单实例2000行×20列，4万格 | 115ms | 445ms |
| 单实例1万行×20列，20万格 | 127ms | 476ms |
| 四个独立实例，各50行×20列 | 154ms | 1461ms |

两端均主要绘制可见区域，因此首屏耗时不与总单元格数线性增长。Univer每个独立实例需要初始化工作簿和插件服务，本组四实例的固定开销明显。此结果不覆盖裁剪插件后的定制Univer或跨图元运行时复用方案。

本地冷导入本次构建的模块约为VTable96～108ms、Univer320～342ms；这不是生产网络下载时间。本次未压缩代码构建，按实际加载文件逐个gzip后的合计约为0.64MiB与2.44MiB。它们是此最小对照构建的体积，不是当前包含图表、AntD和设计器的伴随包体积。

## 批量更新

| 场景 | VTable setRecords | Univer受控批量mutation |
| --- | ---: | ---: |
| 单实例1000格 | 44ms | 28ms |
| 单实例4万格 | 49ms | 43ms |
| 单实例20万格 | 46ms | 146ms |
| 四实例，各1000格 | 116ms | 36ms |

更新计时覆盖API调用和两个动画帧；输入模型转换另记。每次校验首行数值确实从2变为1002，24个最终样本均更新成功。

这里的调用路径不同：VTable替换记录，Univer在原工作簿上批量写入单元格。只能据此说明更新策略的重要性，不能据此推断任何一方在所有增量更新场景中更快；VTable的局部改值等接口未纳入本轮对照。

首次尝试在viewer模式直接调用FRange.setValues时，修改被权限阻止；这些“很快返回但没有生效”的样本已排除。最终通过syncExecuteCommand执行set-range-values mutation更新本地模型，保持用户侧viewer模式。这是宿主受控的渲染更新通道，正式接入仍须覆盖行列增删、合并和样式变化等结构更新。

## 内存

脚本通过Chrome CDP主动GC后读取JS heap。四实例额外等待3.5秒再采样，以覆盖延迟初始化；包含已加载引擎及本轮模型。结果不包括Canvas/GPU显存、浏览器完整进程或Worker内存。

| 场景 | VTable JS heap | Univer只读 JS heap |
| --- | ---: | ---: |
| 单实例1000格，首屏后 | 8.2MiB | 19.2MiB |
| 单实例4万格，首屏后 | 14.7MiB | 20.7MiB |
| 单实例20万格，首屏后 | 16.6MiB | 27.0MiB |
| 四实例各1000格，等待3.5秒后 | 15.6MiB | 28.4MiB |

四实例在DOM中分别有4个和8个Canvas。实际占用还受Canvas面积、DPR及内部缓存影响，不能把JS heap直接当作真实终端总内存。各实例的代码依赖共用，不能将单实例总量简单乘以图元数量。

## 与当前项目的关系

1. 当前截图中的2000条事实最终只形成少量交叉汇总格；选择引擎时要区分事实条数、展开后的单元格数量和当前分页显示数量。
2. 当前正式展示默认按50行分页。比较四实例的小表开销，对看板场景比单纯的“百万行演示”更有参考价值。
3. 本轮是独立渲染器基准。实际项目还包括React/AntD、共享统计引擎、条件/合并/下钻、字段诊断及图元生命周期；平台总耗时不能直接套用表中数值。
4. 基准采集时的ReportTableView在出版结果变化时会release并重新创建ListTable；本次刷新使用的是setRecords，不能等同为当时图元代码已经达到该耗时。后续已完成[实例复用、字号和缩放优化](vtable-rendering-optimization-and-acceptance-2026-11-03.md)，本页保留原始基准，仍不代表完整平台的端到端耗时。
5. 当前UniverPreview会逐格通过Facade同步值和样式；本次使用批量mutation，也不能等同为现有配置态刷新性能。

建议：看板内多图元、频繁刷新、终端资源敏感的正式展示，优先保留VTable，并优化实例复用和批量更新。少量报表、Excel字体/格式/合并呈现一致性优先的场景，可以评估Univer只读。当前字号pt/px及外层缩放问题应单独修正，它们不是数据量性能测试的结论。

官方资料说明了两者的不同职责：[Univer架构与工作簿/渲染/命令服务](https://docs.univer.ai/blog/this-is-univer)、[Univer Worker计算边界](https://docs.univer.ai/guides/sheets/getting-started/worker)、[VTable Canvas数据表格定位](https://visactor.io/vtable/guide/introduction)。官方大数据演示不能替代当前自定义报表链路的实测。

## 复验

源码和结果位于[验证目录](verification/readonly-renderer-performance-2026-11-03/summary.json)。保留原始24个样本、汇总及基准源码；构建产物和过程截图留在系统临时目录。

```powershell
cd micro-bi
$env:PERF_DIR=Join-Path $env:TEMP 'micro-bi-readonly-renderer-perf'
node node_modules/vite/bin/vite.js build --config doc/verification/readonly-renderer-performance-2026-11-03/vite.config.mjs
# 环境需能加载Playwright，或用PLAYWRIGHT_MODULE指定已有安装的入口。
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node doc/verification/readonly-renderer-performance-2026-11-03/benchmark.cjs
```

复验产生results.json、截图等临时输出。基准未修改生产渲染代码或自动切换图元展示引擎。
