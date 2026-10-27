# 第31节多级维度整改与验收

日期：2026-10-23。范围：保留模式三原入口和左侧面板，支持时间维度与多级行列分类共同配置，贯通模板设计、动态预览、保存重开和VTable展示，保留格式、样式、自由备注、人工合并及取消合并意图。

## 实现结果

HDIM-F01、HDIM-F02已整改并验收。原第31节的7组诊断由2组通过、5组遗漏变为7/7通过；本轮新增23项专项，全库286项测试通过，真实浏览器12项功能检查通过，未捕获pageerror。库ESM/CJS和宿主生产构建通过；宿主仍有大包提示。

### 配置与编译

- 新增`hybridAxes.ts`，将行时间及所有行分类、列时间及所有列分类规范化为完整有序轴，不再取分类数组第0项或用OR在时间和分类之间二选一。
- 新建配置默认时间在前，分类按选择顺序排列；重开保留既有轴父链顺序，显式重排分类后按新顺序执行。时间轴保留粒度、时区、周起始日和自定义间隔等属性，原值日期分类与时间分桶拥有独立身份。
- 新增`compileHybridHierarchy.ts`，按所有行轴和列轴生成父格链。指标绑定两轴的叶节点，按完整行列路径的事实交集计算。表头行数、行标签列数、指标起点、宽度及总计位置随层级计算。
- 为每级行轴生成竖向分组覆盖规则，为每级列轴生成横向规则。原适配器简单双层分组和明细结构保留兼容路径，显式defaultRowDim/defaultColDim选项继续有效。

### 保存重开与校验

`hybridConfig`升级为兼容version 1的version 2，包含有序rowAxes、columnAxes、showRowTotals、enableGroupMerge及必要的合并保留信息。重开优先恢复这些意图，旧文档按父格链恢复轴顺序，不再从数据采样类型或cells偶然顺序猜测时间字段。

发布前校验配置轴与实际轴格的字段、角色、分桶、数量和父链；缺失字段、重复配置、错误父链及未完整编译均阻止保存。新增布局与自由备注占位冲突时，保留源备注并显示错误，不再把备注当作样式覆盖吞掉。右侧提示行、列各几级，校验失败时明确显示并阻止预览发布。

数据集字段校验接受登记的字段元数据，并覆盖所有事实记录，避免只采样前100条而误判稀疏字段；登记字段暂时全空或空数据重开不因此丢失轴定义。

### 保留样式、备注和合并

- 改变维度前同步设计画布快照，继续按实际已应用grid对应的管理清单解释快照。
- 指标覆盖按指标身份迁移，维度覆盖按轴角色、字段及时间/分类身份迁移。旧字段位置不再决定样式归属；面板负责更新新父链，旧高级覆盖不能恢复旧叶轴。
- 格式、精度、单位、条件规则和样式继续合成。自由备注的源位置保持；涉及动态块的运行时位移由编译器执行。静态备注的人工合并范围与备注采用同一位移，避免文字移动后合并仍留在旧坐标。
- 中性grid记录mergeOrigins，预览原生取消合并时按来源回写：分组取消保存为完整父组上下文例外，人工合并取消保存为禁用源规则；新增人工实例合并保存语义定位。切换模式、保存、重开和输入重排不把投影固化为人工坐标规则。
- 合并目标的旧主/次轴ID按字段身份重绑定；暂时移除的轴规则及例外保留在配置中，投影仅启用当前布局可解析的规则。显式重新开启“同类项合并”恢复默认分组覆盖。

### 已保存卡片的数据刷新

宿主`dynamic-data-test/src/App.tsx`原来仅为`authoringMode === 'cell'`重编译保存包；已将hybrid纳入相同事实版本刷新链路，并传入登记字段元数据。新数据可直接更新VTable发布对象，无需重开编辑器再保存；展示端继续只消费中性publication，不加载Univer。

## 自动化验收

新增[`test/hybrid-multiaxis.test.mjs`](../test/hybrid-multiaxis.test.mjs)，23项覆盖以下范围：

| 用例 | 断言 |
| --- | --- |
| HDIM-01～04 | 时间+两级行分类、时间+两级列分类完整；交叉值按全部路径事实交集；同名标签不跨父组误合并；增删、逆序、JSON往返及VTable适配正确。 |
| HDIM-05～07 | 时间+三级分类的分组报表不截断；没有行轴的多级列报表可用；同字段原值分类与时间桶身份分离。 |
| HDIM-08～10 | 缺轴、改错粒度、错误父链、重复分类、未知字段被阻止；完整意图和旧父链顺序可恢复。 |
| HDIM-11～14 | 新增/重排维度后格式、单位、样式和备注保留；占位冲突不丢备注；关闭多级合并不复活；人工备注合并和宽度合成保留。 |
| HDIM-15～18 | 原生取消父组后数据变化仍保持例外；人工备注合并随位移；取消人工合并不复活；自定义时间间隔求值。 |
| HDIM-19～23 | 稀疏/声明字段校验；旧次轴合并身份迁移；时间属性和顺序恢复；休眠规则保留；旧默认维度选项兼容。 |

| 执行 | 结果 | 证据 |
| --- | --- | --- |
| 原第31节7组诊断重跑 | 7/7通过 | [重跑结果](verification/hybrid-multiaxis-acceptance-2026-10-23/adapter-recheck.json) |
| 多级维度专项 | 23/23通过 | [专项日志](verification/hybrid-multiaxis-acceptance-2026-10-23/focused-tests.log) |
| 全库`npm run test:only` | 286/286通过 | [全量日志](verification/hybrid-multiaxis-acceptance-2026-10-23/unit-tests.log) |
| 库`npm run build` | ESM/CJS、声明和postbuild通过 | [库构建](verification/hybrid-multiaxis-acceptance-2026-10-23/library-build.log) |
| 宿主`npm run build` | TypeScript及Vite生产构建通过，大包提示保留 | [宿主构建](verification/hybrid-multiaxis-acceptance-2026-10-23/host-build.log) |

## 真实浏览器验收

在原模式三菜单创建“[多级维度验收] 时间与车间产品”，使用独立Chromium上下文，不修改用户浏览器存储。配置行轴为完工月→车间→产品，列轴为投产月→车间→产品，指标为交付/缺陷，指标添加“件”和加粗，并录入自由备注及人工合并。

| 编号 | 操作和结果 |
| --- | --- |
| MX-01 | 模板及预览均为三层行轴、三层列轴；交付行总计之和10850；维度新增前设置的指标单位、加粗及备注保留。 |
| MX-02 | 保存、刷新、重开，两个时间字段及四个分类选择全部回显。 |
| MX-03 | 原C5指标移至E6后，高级属性重开仍有“件”和加粗。 |
| MX-04 | 关闭同类项合并，设计/预览往返、保存重开后仍关闭。 |
| MX-05 | 新增一条事实，包含新车间、新产品及新月份；直接刷新已保存卡片，新增行列自动出现，交付总计10973，单位备注保留。 |
| MX-06 | 上述14条事实输入逆序，VTable二维文本逐字一致。 |
| MX-07 | 删除1号车间的全部事实，该车间及仅属于它的产品对应行列消失，总交付6450，备注和单位保持。 |
| MX-08 | 恢复13条原事实，VTable文本与基线逐字一致。 |
| MX-09 | 行分类重排为产品→车间，清空列轴切换到时间+两级分类的分组报表，交付10850；格式备注保留，保存重开顺序完整。 |
| MX-10 | 恢复三层列轴及默认分组覆盖，保存刷新正常；首行系统标题设置居中，保存重开仍居中。 |
| MX-11 | 通过原生菜单取消月份合并，切换模式、保存重开后该月份保持取消，其他分组继续覆盖。 |
| MX-12 | 设计态F2:G2原生人工合并保留备注，展开后的备注和合并区共同迁移，保存重开保留；边界由HDIM-16/17专项复验。 |

12项通过，pageErrors为空。证据：[浏览器记录](verification/hybrid-multiaxis-acceptance-2026-10-23/browser.json)、[三层模板](verification/hybrid-multiaxis-acceptance-2026-10-23/three-by-three-design.png)、[三层预览](verification/hybrid-multiaxis-acceptance-2026-10-23/three-by-three-preview.tsv)、[重开全部轴](verification/hybrid-multiaxis-acceptance-2026-10-23/reopened-all-axes.png)、[迁移后样式](verification/hybrid-multiaxis-acceptance-2026-10-23/reopened-migrated-style.png)、[取消月份合并后重开](verification/hybrid-multiaxis-acceptance-2026-10-23/native-unmerge-reopened.png)、[多级分组预览](verification/hybrid-multiaxis-acceptance-2026-10-23/grouped-time-two-categories-preview.tsv)、[最终VTable](verification/hybrid-multiaxis-acceptance-2026-10-23/final-no-fixture-vtable.tsv)。

数据变化采用**仅拦截独立测试上下文的`/src/mockData.ts`请求**的方式替换数据源导出数组，再刷新同一份保存的看板。没有修改事实源文件、用户浏览器或通过私有应用状态注入数据；MX-05～08没有重开编辑器或重存。它证明数据源新版本被宿主自动消费，不等同于另行测试了真实服务端推送API。结束时移除拦截、恢复真实源，核对文本后关闭测试浏览器。

数据证据：[基线](verification/hybrid-multiaxis-acceptance-2026-10-23/facts-baseline-vtable.tsv)、[新增](verification/hybrid-multiaxis-acceptance-2026-10-23/facts-added-vtable.tsv)、[逆序](verification/hybrid-multiaxis-acceptance-2026-10-23/facts-reversed-vtable.tsv)、[删除](verification/hybrid-multiaxis-acceptance-2026-10-23/facts-deleted-vtable.tsv)、[恢复](verification/hybrid-multiaxis-acceptance-2026-10-23/facts-restored-vtable.tsv)、[源码及汇总](verification/hybrid-multiaxis-acceptance-2026-10-23/checks.json)。

## 与静态文本动态满宽需求的边界

上述为2026-10-23本轮验收的能力边界：当时保留备注和合并，没有新增任意静态范围跟随。**2026-10-26已完成通用静态单元格/区域范围跟随**，不限制行号；最新实现及验收见[专项报告](static-span-implementation-and-acceptance-2026-10-26.md)与清单第34节，第33节保留设计方案及更新状态。
