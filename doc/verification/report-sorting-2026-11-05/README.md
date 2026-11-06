# 排序验收证据（2026-11-05）

- [checks.json](checks.json)：核心、宿主测试和构建检查汇总。
- [browser-checks.json](browser-checks.json)：三类报表真实排序交互41项；包括 VTable/Univer 表头入口、明细拖拽多条件、分组排序、交叉行列独立、数据变化、保存重开及撤销重做。
- [platform-checks.json](platform-checks.json)：既有宿主接入14项。
- [input-checks.json](input-checks.json)：原生输入及IME12项。
- [formula-checks.json](formula-checks.json)：公式、自定义表头和合并15项。
- [measure-order-checks.json](measure-order-checks.json)：左侧指标排序32项。
- [交叉表预览](pivot-preview.png)、[分组表预览](grouped-preview.png)、[明细表预览](detail-preview.png)：实际宿主配置画布，保留原有18pt红色指标样式。

脚本运行在独立 Chrome context，工程与数据源写入均由内存 API fixture 接管。没有操作真实工程或服务端配置。浏览器案例中的“发布”也只写隔离 fixture。

实现、规则边界和复验入口见[实施文档](../../report-sorting-implementation-and-acceptance-2026-11-05.md)。
