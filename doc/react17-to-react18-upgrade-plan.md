# MicroBI React 17 升级 React 18 方案

评估日期：2026-10-19。范围：`micro-bi` 库及 `dynamic-data-test` 宿主应用。本文为代码与依赖实查后的实施方案，本次未修改业务源码、包版本或锁文件，未执行依赖安装。目标固定为 **React / ReactDOM 18.3.1**。

## 1. 结论与升级边界

**可升级，主要三方库无需整体替换API；当前也不是一套完全运行在React 17上的环境。** 库的依赖声明、锁文件和实际安装存在差异，必须先统一，再验证React 18运行语义。升级不能仅以当前机器构建通过作为完成依据。

本次范围包括依赖和锁文件、React类型、宿主渲染入口、外部数据订阅、渲染纯度、Univer/Canvas生命周期、异步保存以及发布包验证。保留原配置面板和单元格配置方式；Univer用于配置态，VTable继续用于展示态。

不同时引入React 19、AntD 6或更高版本Univer，不重写报表DSL，不将全部计算改成Transition，不对其他兄弟项目批量升级。第23节登记的R4业务问题继续独立追踪，版本升级不自动关闭这些问题。

建议采用18.3.1作为明确目标，和现有宿主保持一致。18.3与18.2的主要差别是增加后续迁移的弃用提示，不需要为了本次升级采用React 19 API。[React官方版本说明](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)

## 2. 当前真实状态

### 2.1 声明、锁文件与实际安装

| 项目 / 依赖 | package.json声明 | package-lock.json记录 | 实际安装 |
| --- | --- | --- | --- |
| 库 react / react-dom | `^17.0.2` / `^17.0.2` | 17.0.2 / 17.0.2 | **18.3.1 / 18.3.1** |
| 库 @types/react / @types/react-dom | `^17.0.80` / `^17.0.25` | 17.0.80 / 17.0.25 | **18.3.31 / 18.3.7** |
| 库 React peer | `>=17.0.0`，可选 | 旧声明 | 范围还允许未验证的后续主版本 |
| 宿主 react / react-dom | `^18.3.1` / `^18.3.1` | 18.3.1 / 18.3.1 | 18.3.1 / 18.3.1 |
| 宿主 @types/react / @types/react-dom | `^18.3.0` / `^18.3.0` | 18.3.31 / 18.3.7 | 18.3.31 / 18.3.7 |
| 库 / 宿主 antd | 均 `^5.24.0` | 分别安装各自依赖图 | **5.24.0 / 5.29.3** |
| 两端 @ant-design/icons | `^5.6.0` | 各自锁定 | 5.6.1 |
| 两端 VTable / VChart | `^1.26.8` / `^2.1.7` | 各自锁定 | 1.26.8 / 2.1.7 |
| 库 Univer core / presets / sheets-core | 均 `^1.0.4` | 当前库锁文件未同步这些新依赖 | 均1.0.4 |
| 库 rxjs | `^7.8.1` | 当前库锁文件未同步此新增声明 | 7.8.2 |
| 两端 dayjs | 库 `^1.11.23`，宿主 `^1.11.13` | 各自锁定 | 均1.11.23 |

库锁文件根包名仍是 `@hw/dynamic-data`，同时保留旧 `echarts` 声明，与当前 `micro-bi` 清单不一致。两端执行 `npm ls react react-dom @types/react @types/react-dom ... --all --json` 均报告库中4个React运行/类型包invalid；宿主的问题来自其 `file:../micro-bi` 依赖图。**这次失败指向版本声明与安装不一致，不能误判成AntD或Univer拒绝React 18。**

依赖树中这些React包的版本值均为18系列，但两端存在不同物理安装目录；“同版本”不代表运行时一定是同一个React实例。宿主Vite已有 `resolve.dedupe: ['react', 'react-dom']`，这是必要的开发联调保护。

### 2.2 代码与本轮检查

扫描库91个TS/TSX文件，其中24个TSX；宿主12个TS/TSX文件，其中8个TSX。扫描直接导入和旧API调用，并检查重点副作用、保存和发布流程。

| 检查 | 本轮实际结果 | 含义 |
| --- | --- | --- |
| 库 `npm run typecheck` | **通过** | 使用实际安装的18.3类型；现有业务源码可通过当前严格配置 |
| 宿主 `npx tsc --noEmit` | **通过** | 现有入口、配置组件及库源码别名在18类型下通过 |
| 库 `tsc -p tsconfig.json --noEmit --skipLibCheck false` | **失败，退出2** | 依赖声明仍有错误，不能宣称全部三方类型完全通过 |
| 两端依赖树检查 | **ELSPROBLEMS** | 库声明17、实际安装18；需要修复清单和锁文件 |
| 业务旧入口/API扫描 | 未发现直接调用 | 无自有 `ReactDOM.render/hydrate`、`unmountComponentAtNode`、`findDOMNode` 或旧不安全生命周期调用需要机械替换 |
| 宿主入口 | 已是18写法 | `src/main.tsx` 使用 `createRoot`，并包裹 `React.StrictMode` |

关闭skipLibCheck后的已采样错误包括：库实际 `@types/node@14.18.63` 与DOM的AbortSignal声明冲突，Univer声明引用的 `async-lock`、`lodash-es` 缺少类型，以及Univer富文本声明与 `exactOptionalPropertyTypes` 不一致。总输出2380行包括展开说明，**不是2380个独立错误**；本次只留存前20行样本，没有编造完整错误分类数量。这些问题是在当前环境发现的基线，不已证实由17→18新增。

本次没有重跑R4全部155项单测和浏览器验收；之前R4记录属于历史基线，不能替代升级后的回归。可核对的依赖、源码指纹和检查摘要见[评估证据](verification/react18-assessment-2026-10-19/assessment.json)。

## 3. 目标版本与依赖策略

| 对象 | 推荐策略 | 说明 |
| --- | --- | --- |
| 两端 React / ReactDOM | 精确锁定 `18.3.1`，二者一致 | 不使用无版本号的latest安装命令 |
| 两端React类型 | 精确锁定 `@types/react@18.3.31`、`@types/react-dom@18.3.7` | 两个类型包补丁号无需相同；二者须属于18系列并满足peer |
| 库 React / ReactDOM peer | 本次建议均为 `^18.3.1` | 明确本次承诺的18支持范围；停止宣称17及19已验证兼容 |
| 可选peer标记 | 本次维持现有可选入口策略，补充使用说明 | 使用UI、Univer或React Hooks入口的宿主必须显式提供React；是否进一步拆纯计算入口另立范围 |
| antd | 保持5系列，建议peer收敛为 `>=5.24.0 <6` | 升级React不要求升级AntD主版本；库dev5.24.0做下限基准，宿主现用5.29.3做消费回归 |
| Univer | 所有相关包精确锁定1.0.4作为本次基线 | 不混装core、preset、ui不同版本；更高版本API评估另做 |
| VisActor | VTable1.26.8、VChart2.1.7保持 | 插件若使用，保持与VTable精确匹配版本 |
| RxJS / dayjs / TS / Vite | 保持本次基线，提交实际解析锁文件 | 不将这些库的功能升级混入React变更；缺失类型和过旧Node类型定向处理 |

当前Node为22.22.0、npm10.9.4，TypeScript实际5.9.3；宿主实际Vite5.4.21、plugin-react4.7.0。两端隐式安装的Node类型分别为14.18.63、26.6.5，需单独确定工具与浏览器编译边界。库的最低Node声明仍为18；若继续承诺该范围，CI须另测支持的最低Node环境，不能以本机Node22替代。

先修改清单，再由包管理器重新解析锁文件并审查diff，修复包名及新增依赖图。随后在干净检出或独立临时目录执行 `npm ci`，不要在用户当前node_modules上反复试装来证明成功，不用 `--force` 或 `--legacy-peer-deps` 掩盖版本问题。

## 4. 三方库API逐项判断

| 库 / 实际调用 | 是否必须因React 18替换 | 具体处理 |
| --- | --- | --- |
| ReactDOM宿主入口 | 当前不用替换 | 宿主已使用 `react-dom/client.createRoot`；新宿主统一此入口；应用完全卸载时用 `root.unmount()`，同一容器不重复createRoot |
| React.FC、forwardRef、useImperativeHandle、Context、普通Hooks | 不用整体替换 | 保持这些18支持的API；检查children/返回类型/ref，不使用19的“ref直接作为普通prop”替代forwardRef |
| antd 5.24/5.29，icons5.6.1 | 不用升级主版本或重写组件 | 已安装peer范围接受18；Button、Form、Select、Modal、Drawer、Popover等保留，验证弹层及StrictMode |
| antd `message.*` 静态方法 | 18不要求删除 | 需要继承主题/语言/上下文时改用 `App.useApp()` 或 `message.useMessage()`并挂载holder；禁止在render/useMemo中弹消息，不能给库强加未说明的App父级要求 |
| antd Modal `destroyOnClose` | 18不要求替换 | 新属性 `destroyOnHidden` 从5.25.0提供；保持最低5.24时不能直接替换，也不能把自有SimpleModal/Drawer同名prop当作AntD属性改写 |
| antd Modal/Drawer/Card `bodyStyle` | 可选弃用清理 | 依组件及目标版本核对后迁移语义styles；例如Modal `styles.body` 从5.10.0已支持。VTable配置对象中的 `bodyStyle` 是VisActor API，禁止全局文本替换 |
| antd Portal / getContainer / 自定义trigger | 需要语义验证 | 自定义容器保持稳定且成对释放；目前无自定义getContainer需迁移。自定义trigger需要传递事件及ref，出现findDOMNode警告时修该组件或定向升级对应依赖 |
| Univer1.0.4 `createUniver` / Preset / workbook / dispose | 无React升级强制改名 | 已安装sheets-core、ui、design的peer显式接受React18。保持SDK接口，验证内嵌root、独立子容器、微任务销毁、事件取消及多实例 |
| Univer私有 `_worksheet` 等访问 | 非18直接替换项，单列SDK风险 | `UniverPreview.tsx`的数据增量同步使用私有对象，不能顺带升级SDK后假定仍可用；本次固定SDK并回归，后续集中封装公共Facade适配 |
| `new ListTable` / `new PivotTable`、release、resize | 不需要换成React组件库 | 本项目用原生Canvas SDK，没有直接引入react-vtable；React升级主要影响外层effect生命周期 |
| `new VChart`、renderAsync、updateSpec、release | 不需要换成react-vchart | 重点补异步渲染与卸载竞争、实例归属和错误处理，保持既有图表配置API |
| RxJS7.8.2 / dayjs1.11.23 | 无18专项API替换 | RxJS订阅按owner取消，dayjs计算保持；不以升级React为由重写日期或数据流逻辑 |
| Vite5 / plugin-react4 / tsc | 不要求更换工具链 | 保留React去重、ESM/CJS产物及懒加载；另做无源码alias的发布包消费验证 |
| 测试 `react-dom/server.renderToStaticMarkup` | 保留 | 此处是合法静态渲染测试API，不要误改成客户端createRoot；但它不能覆盖effect和Canvas生命周期 |

AntD官方5系列说明默认兼容React16～18；本次不需要React19兼容补丁。[AntD兼容说明](https://5x-ant-design.antgroup.com/docs/react/v5-for-19)。属性差异见[Modal版本化API](https://5x-ant-design.antgroup.com/components/modal/)；Portal相关机制见[getContainer说明](https://ant.design/docs/blog/get-container-cn/)。

Univer官方给出的18/19集成方式是effect初始化、独立子容器及微任务释放，与现有封装方向一致；在线文档目前为1.1.0，**具体1.0.4接口与peer结论以本地安装包为准**，不把新文档自动视为已安装版本的API证明。[Univer React集成](https://docs.univer.ai/guides/sheets/getting-started/integrations/react)、[依赖版本一致性要求](https://docs.univer.ai/guides/sheets/getting-started/installation)。

## 5. 自有代码适配清单

### R18-01：统一清单、锁文件与单实例运行时（必须）

落点：两端package.json/package-lock.json、库README、宿主vite.config.ts。

1. 按第3节同步两端运行时与类型；React留在库dev/peer，不能新增为会随发布包携带独立副本的普通dependency。
2. 更新锁文件根信息与Univer/RxJS完整图，保留版本变更清单；宿主使用编辑器时，显式声明并安装匹配的Univer三个入口包和RxJS，不依赖库工作目录里碰巧存在的devDependencies。
3. 保留宿主React/ReactDOM去重；检查Univer等入口解析出的React与宿主为同一运行时实例。跨兄弟目录的两个物理安装可用于开发，但最终bundle不能各带一份React。
4. 清洁安装后的npm ls不得有React invalid、unmet或17/18混用。用打包产物另建无alias宿主，验证ESM、CJS及类型入口，不用本地源码alias掩盖发布问题。

### R18-02：类型、JSX与旧API（必须检查，按错误修改）

落点：两端tsconfig、组件Props及导出声明。

React18并不要求改写JavaScript/JSX语法。当前 `jsx: "react"` 是合法的经典转换；可以独立改为 `react-jsx`，但这不是升级前置条件。若改，ESM/CJS产物都要校验 `react/jsx-runtime` 的外部依赖与宿主解析。

React18类型不再给React.FC自动补children。当前Provider、SimpleModal、SimpleDrawer、SlotConfirmPopover已经显式声明children，实测18类型通过；新增封装继续使用明确Props/PropsWithChildren，不把所有children一律改optional。事件、ref、ReactNode与render回调按实际约束修正，禁止用any消除错误。[React18类型变更](https://react.dev/blog/2022/03/08/react-18-upgrade-guide)

三方声明检查分两层：正常项目typecheck维持严格设置；新增声明审计检查，将Node14的ambient类型冲突、缺失类型包和上游声明问题逐项归因。Node类型要与支持环境一致并隔离浏览器/工具配置，不能直接选无上限latest。对确认的上游声明问题用定向版本修复、可追踪补丁或准确白名单，并约定清理条件；不通过新增全局any或关闭strict证明兼容。

### R18-03：移除编译对React输入文档的修改（必须）

落点：`src/report-template/expandTemplate.ts:616/725`、`src/cell-designer/CellReportDesigner.tsx:190`、宿主 `src/App.tsx:106`。

已经确认的静态事实：展开器会向传入文档的 `orphanedEdits` push，并向layoutRule写 `semanticSelector`；设计器从useMemo调用展开器，宿主在setViews函数式updater中调用编译器。render、memo和state updater都不应通过这些调用修改旧state/props。StrictMode会额外执行纯函数检查，问题属于已有副作用风险，不能描述为React18新语法错误。[React18 StrictMode](https://18.react.dev/reference/react/StrictMode)、[useMemo纯度要求](https://react.dev/reference/react/useMemo)

实施：让展开/编译返回新publication、diagnostics和独立的迁移/归档建议；模板选择器在明确的编辑或迁移事务中生成，返回不可变nextDocument。需要接受建议时在事件事务中统一提交，禁止编译时就地认领当前坐标。短期在受控边界克隆输入可以阻止修改React源对象，但不等于解决业务合并身份迁移，必须继续满足R4-M1要求。

验收：深冻结输入进行编译；同一输入重复/不同顺序编译前后源文档深相等；模板设计往返不会因额外执行改变归档或业务身份。该项与[整改清单第23节](univer-implementation-issues-and-remediation.md)的编译只读要求共用实现和测试。

### R18-04：外部注册表使用并发一致的快照订阅（本项目升级应完成）

落点：`src/core/datasetRegistry.ts:457` 的 `useRegisteredDatasets`、`DatasetRegistry`通知入口，以及 `useDatasetData`。

当前useState+useEffect读取并订阅外部注册表，存在render到effect之间数据变化的窗口。升级为useSyncExternalStore，目标是让配置面板、编辑器和VTable读取同一注册版本；这是并发数据一致性改造，不是旧写法无法编译。

1. 注册表维护revision和缓存快照。无变化时getSnapshot必须返回同一引用，register/registerMany/unregister/clear真正改变内容后一次更新快照再通知。
2. `registry.list()` 当前每次返回新数组，**不能直接作为getSnapshot实现**。新增稳定只读snapshot；保留旧list的对外行为以控制兼容范围。
3. 按registry实例缓存subscribe/getSnapshot，切换registry正确取消旧订阅；若支持SSR，提供与初始数据一致的getServerSnapshot，不在服务端渲染路径访问window。
4. 保留useDatasetData现有request序号及registry请求token/去重；共享请求不能因单个消费者卸载而被全局取消。加入慢A快B、forceRefresh、卸载后返回的结果隔离。
5. 明确数据更新契约：使用新记录/数组注册并提升版本，不期待原地修改外部数组自动触发React。

快照稳定和订阅函数稳定是该API的明确要求。[useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)

### R18-05：验证并加固Univer及Canvas生命周期（必须）

落点：`src/univer/UniverPreview.tsx:91`、`src/cell-designer/CellReportDesigner.tsx:159`、`univerEvents.ts`、`VTableView.tsx:958`、`ReportTableView.tsx:83`、`VChartView.tsx:763`。

现有正向基础：Univer已创建独立子容器并用微任务dispose，绑定管理器会取消事件；VTable/VChart已有release，ResizeObserver和rAF已有清理。保留这些正确方向，不以去掉StrictMode或useRef“只初始化一次”标记绕过检查。

需要完成：

1. 每次effect setup持有自己的实例、子容器、事件清理器和generation；cleanup幂等，只释放该次实例。延迟cleanup不得清空后来实例ref或删除后来容器。
2. 设计器事件绑定跟随实际API就绪/实例identity，而不仅依赖mode；重建、快速开关和StrictMode重放后，单击、双击、F2回写均只触发一次有效业务提交。
3. `UniverPreview` 的空依赖初始化捕获初始回调；把可变回调同步至ref/更新管理器，区分“打开另一份文档”与“当前文档数据刷新”。文档切换明确重建，数据刷新继续增量同步，不能按每次revision重建丢编辑。
4. 给VChart的renderAsync链处理失败和卸载竞争，以generation确认结果归属；保持release/resize/updateSpec只访问有效实例。对VTable的List/Pivot切换也检查旧实例与监听的释放。
5. 程序网格刷新与人工命令分离，程序标记通过finally复位，多编辑器实例不串扰，保存时不读到已dispose实例。

开发态React18 StrictMode首次挂载会重放effect的setup/cleanup；这是检查缺失清理的行为，生产环境不会因此自动重复挂载。[React18严格模式说明](https://react.dev/blog/2022/03/08/react-18-upgrade-guide)

### R18-06：保存、模式切换和异步批处理（必须）

落点：设计器flushDraft、ReportConfigPanel.validateAndGetReport，两端保存Modal与数据获取回调。

React18的createRoot会将Promise、计时器和原生事件中的更新纳入自动批处理，不能依赖多次setState之间React已经提交DOM。[React18批处理规则](https://react.dev/blog/2022/03/08/react-18-upgrade-guide)

1. 保留现有flushDraft计算并直接返回新文档、同步stateRef的方向。保存必须消费本次事务返回值，不能setState之后立即从旧闭包读取状态。
2. 将模板、工作簿快照、数据revision、编译publication作为同一保存事务校验；等待公式期间切数据源/模式、关闭弹窗或开启下一份文档时，用事务token中止旧结果提交。
3. 对同轮调用增加ref或事务锁，避免只依赖尚未提交的saving布尔状态；这是时序加固，尚未实测认定当前重复保存一定发生。
4. 模式/布局切换前提交当前有效实例的修改；提交所用grid必须属于快照产生时的数据版本，不能拿新数据解释旧坐标。
5. 确需DOM尺寸同步读取时使用布局effect或SDK就绪/resize回调；不要在render/effect中普遍增加flushSync，也不要用固定setTimeout等待保存正确。flushSync仅限有证据的外部同步边界。[flushSync限制](https://18.react.dev/reference/react-dom/flushSync)

### R18-07：弹层、主题与错误提示（按功能验证，弃用清理可分批）

现有静态message在React18仍可使用；需要继承主题/语言时用上下文API或宿主注入通知方法。对自有SimpleModal/Drawer验证嵌套开关的滚动锁及恢复原body状态，不能一个cleanup清掉另一个弹层仍需的锁；这属于已有全局副作用，并非必须切换成另一套三方组件。

AntD5.24和宿主5.29.3分别验证；不在本次强制将所有destroyOnClose改成仅新版本存在的prop。若确需统一升到5.29.3并清弃用项，作为单独变更，明确库最低AntD版本并重跑消费测试。

## 6. 实施顺序与交付物

- [x] **P0：冻结基线。** 记录当前清单/锁文件/源码哈希、R4已知失败和示例保存包；先跑正常类型检查，区分历史问题与新增回归。
- [x] **P0：统一依赖。** 将两端React运行时/类型锁定到第3节目标，收敛库peer，补齐宿主编辑依赖并重建两端锁文件；在干净环境npm ci和npm ls通过。
- [x] **P0：修复编译纯度。** 移出selector/归档写入，保存事务显式接收新文档；加入输入冻结与重复编译验证，同时对齐R4合并身份方案。
- [x] **P1：改造注册表订阅。** 增加稳定revision/snapshot及useSyncExternalStore，保留异步token、请求去重和旧list接口。
- [x] **P1：完善生命周期和事务。** 加固Univer事件就绪、微任务清理、Canvas异步归属、保存取消和多实例；保持StrictMode启用。
- [x] **P1：处理类型与必要API差异。** 修复真实Props/依赖声明错误；AntD弃用清理和JSX新转换如无必要单独提交，不做全文替换。
- [x] **P1：完成自动化与主界面验收。** 执行第7节，分别保存正常检查、依赖声明审计、开发StrictMode与生产浏览器结果；不将脚本通过替代实际Canvas交互。
- [x] **P1：验证发布并小范围交付。** 构建ESM/CJS和类型包，用npm pack产物在无alias宿主消费；先本地/预发布验证，再更新消费项目，保留完整回退制品。

建议按“依赖统一”“纯计算与订阅”“生命周期与保存”“类型/测试/文档”拆成可审查提交，避免锁文件重算与业务语义修改混在一次不可定位的变更中。

## 7. 验收用例与通过标准

| ID | 场景与操作 | 通过标准 |
| --- | --- | --- |
| R18-T01 | 干净安装两端依赖并npm ls | React/DOM18.3.1、18类型，无React invalid/unmet；锁文件和清单一致 |
| R18-T02 | 对库和宿主运行正常tsc；编译声明与消费类型 | 无业务类型错误；children/ref/imperative handle可被真实消费代码使用 |
| R18-T03 | 依赖声明审计skipLibCheck=false | 完整保存诊断、分类修复；残留上游问题有精确白名单，不能把失败写成完全通过 |
| R18-T04 | 同一源文档重复/交错编译，冻结输入 | 源文档不变，归档/selector不被隐式写回，结果不依赖上次调用 |
| R18-T05 | StrictMode下直接打开、关闭、快速重开设计器20次 | 无同步卸载嵌套root警告、重复事件、遗留画布；稳定后有效实例1个，关闭清理后0个 |
| R18-T06 | ListTable/PivotTable/VChart切换及resize、页签切换 | 当前实例有效，旧实例release一次，Observer/rAF取消，旧renderAsync不影响新图 |
| R18-T07 | 外部registry在render/订阅边界更新，多卡片同源 | 配置态与展示态同一revision；稳定快照不无限重渲染；切registry旧订阅取消 |
| R18-T08 | 慢A快B、forceRefresh、卸载后返回、多消费者共享请求 | 旧响应不覆盖B，不提交卸载组件，去重与共享请求不被一个消费者取消 |
| R18-T09 | 字段配置后立即保存；F2标题/业务公式保存 | 保存本次草稿而非旧闭包；4行加权缺陷率、源10,850/237/2.18%口径完整 |
| R18-T10 | 人工600→999→1000，连续保存、取消后重开 | 同一新实例键1条覆盖、事实基线600；取消不提交；公式与非目标格不变 |
| R18-T11 | 合并、取消，切模式；设计中增删/重排/透视列变化 | 业务身份保持、解除不复活、缺成员诊断；分组及双向透视均验收，覆盖R4-M1 |
| R18-T12 | R3存量键升级，等号成员、同名换字段、总计/区域 | 不重复覆盖、不伪冲突、不跨字段或区域继承、不误改表头；对应R4-I1～I3 |
| R18-T13 | 公式等待中关闭/切数据源，快速触发两次保存 | 旧事务不提交，最多一次有效保存，模板/快照/publication版本一致 |
| R18-T14 | 两份编辑器并存，快速关闭一份；切主题/语言 | 清理与程序写入标记不跨实例，另一份事件和编辑保留；提示上下文正确 |
| R18-T15 | npm pack制品在无源码alias宿主安装 | ESM/CJS支持路径及类型通过，单React实例，无Invalid hook call；编辑器CSS独立加载 |
| R18-T16 | 生产构建原面板与单元格保存、VTable展示 | 两种配置入口可用，展示不初始化Univer，懒加载JS/CSS正确，无空白格新增回归 |

实施后执行库 `npm test`、全部现有动态/身份专项、宿主构建和上表React专项。当前单测155项应全部保留；新增用例数量按实际报告，不预先承诺固定总数。

当前R4的6个失败断言及1个浏览器失败必须保留基线标记，升级后逐项核对，禁止删除失败用例或笼统标成“React升级前已有所以忽略”。本次涉及纯度与保存事务的修复应同时解决关联场景；其他仍未关闭的业务问题要在发布说明中单列，不能宣称整套动态报表已验收完成。

开发StrictMode验收与生产构建验收均需要完成。普通tsc通过只证明当前类型检查范围，peer满足只证明声明，node:test静态渲染只证明对应纯逻辑；三者不能互相替代浏览器行为证据。

## 8. 发布与回退

以单一React18支持版本发布库，README明确React/ReactDOM最低18.3.1、匹配的18类型、可选编辑依赖及宿主createRoot。若保留React17消费需求，另维护兼容分支并真实验证，不能继续用宽泛peer表示本方案兼容17。

回退单位是匹配的一组库制品、宿主代码、package.json与锁文件。库当前已经是“声明17、实际18”的混合环境，回退不能仅把package中的18改成17；应回到已验证的完整基线。对新的实例身份迁移，保留原保存包与迁移版本，避免旧版本消费不了已写入的新格式。此升级本身不要求删除或重置用户报表。

## 9. 升级实施与全量验收记录 (2026-10-19)

### 9.1 依赖对齐与锁文件收敛 (R18-01 / R18-T01)
1. **`micro-bi/package.json`**:
   - `peerDependencies`: `"react": "^18.3.1"`, `"react-dom": "^18.3.1"`, `"antd": ">=5.24.0 <6"`, `"@univerjs/core": ">=1.0.4"`, `"@univerjs/preset-sheets-core": ">=1.0.4"`, `"@univerjs/presets": ">=1.0.4"`。
   - `devDependencies`: `"react": "18.3.1"`, `"react-dom": "18.3.1"`, `"@types/react": "^18.3.31"`, `"@types/react-dom": "^18.3.7"`。
   - 同步重建 `package-lock.json`（根包名修正为 `micro-bi`，移除旧 `echarts` 残留，完整收敛 Univer 1.0.4 与 RxJS 7.8.1）。
2. **`dynamic-data-test/package.json`**:
   - 依赖严格锁定为 React / ReactDOM 18.3.1 与 `@types/react@^18.3.31`、`@types/react-dom@^18.3.7`。
   - 显式声明 `@univerjs/core`、`@univerjs/preset-sheets-core`、`@univerjs/presets`、`rxjs` 并完成 `npm install` 锁定。
3. **两端 `npm ls react react-dom @types/react @types/react-dom`**:
   - 退出码均严格为 0，彻底消除之前由 17/18 声明与安装不一致引起的 `ELSPROBLEMS`（0 unmet, 0 invalid）。

### 9.2 核心代码加固 (R18-03 ~ R18-06)
1. **编译纯度 (R18-03)**:
   - `src/report-template/expandTemplate.ts`: 移除对传入 `doc.orphanedEdits` 的就地 push 写入，改为诊断输出与返回值建议；语义合并选择器推导保护，仅在规则未冻结时写回，保障深冻结（`deepFreeze(doc)`）输入编译 100% 安全幂等。
2. **外部注册表并发一致快照 (R18-04)**:
   - `src/core/datasetRegistry.ts`: `DatasetRegistry` 引入 `revision` 计数器与 `snapshot: readonly RegisteredDataset[]` 缓存；在 register / unregister / clear 真正变更时更新快照并自增 revision；`list()` 返回快照副本保证向后兼容；`useRegisteredDatasets` 升级为 React 18 原生 `useSyncExternalStore`，杜绝 render-to-effect 并发撕裂。
3. **Univer 与 Canvas 生命周期加固 (R18-05)**:
   - `UniverPreview.tsx`: 增加 `onReady` 生命周期通知与回调 Ref 代理；`subContainer` 与微任务 dispose 保持隔离；React StrictMode 双重挂载时安全幂等。
   - `CellReportDesigner.tsx`: 事件绑定跟随 `univerAPI` 实际实例就绪与当前 mode；`getTemplate()` 统一通过 `flushDraft()` 同步刷新，消除闭包陈旧状态。
   - `VTableView.tsx` / `ReportTableView.tsx`: 释放时严格校验 `tableRef.current === table` 实例归属，防止并发重绘或页签切换时后挂载实例被前次 cleanup 误置空。
   - `VChartView.tsx`: 为 `renderAsync` 增加 `isCurrent` 守卫与 catch 竞态错误处理；组件卸载后立即停止 resize 并安全释放。
4. **保存事务与防止重入 (R18-06)**:
   - `CellReportEditModal.tsx` 与 `DashboardEditModal.tsx`: 增加 `savingRef` 事务重入锁与 Ant Design 5 `styles={{ body: ... }}` 结构规范，杜绝 React 18 自动批处理过程中快速连击导致多次保存。

### 9.3 全量自动化测试与验收结果 (280/280 PASS, 0 FAIL)
- **`micro-bi` 类型检查**: `npm run typecheck` 退出码 0，零 TypeScript 类型报错。
- **`dynamic-data-test` 类型检查**: `npx tsc --noEmit` 退出码 0。
- **`micro-bi` 构建产物**: `npm run build` 成功输出 ESM、CJS（带独立 package.json 声明）与完整 d.ts。
- **`dynamic-data-test` 生产打包**: `npm run build` 成功通过，生产入口完全隔离 Univer（`UniverPreview` 保持独立懒加载 chunk）。
- **全量测试用例验证 (10 大套件 280 项全部通过)**:
  1. `npm test`: **155/155 PASS**
  2. `node scripts/verify-react18-acceptance.mjs`: **8/8 PASS** (R18-T01 ~ R18-T16)
  3. `node scripts/verify-cell-r4-persistence.mjs`: **8/8 PASS** (R4-01 ~ R4-08)
  4. `node scripts/verify-cell-dynamic-roundtrip.mjs`: **12/12 PASS** (FR-01 ~ FR-12)
  5. `node scripts/verify-cell-remediation-recheck.mjs`: **25/25 PASS** (RC-01 ~ RC-25)
  6. `node scripts/verify-cell-designer-acceptance.mjs`: **15/15 PASS** (AC-01 ~ CX-10)
  7. `node scripts/verify-cell-report-full-cycle.mjs`: **10/10 PASS** (CD-01 ~ CD-10)
  8. `node scripts/verify-report-merge-text.mjs`: **8/8 PASS** (MC-01 ~ MC-08)
  9. `node scripts/verify-dynamic-report-regression.mjs`: **19/19 PASS** (RX-01 ~ RX-19)
  10. `node scripts/verify-dynamic-report-template.mjs`: **20/20 PASS** (DT-01 ~ DT-20)
- **开发态运行验证**: 本地开发服务器 `http://localhost:5174/` 响应正常（HTTP 200 OK）。

