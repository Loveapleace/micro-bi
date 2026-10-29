# React18运行约定与升级实施记录

维护日期：2026-10-27。React17升级前的依赖差异和待实施方案已删除；本文保留仍适用的API检查、回归要求及升级实施记录。

## 1. 当前运行约定

库和宿主采用React/ReactDOM 18.3.1及匹配的18类型，宿主使用createRoot和StrictMode，外部数据注册订阅使用useSyncExternalStore。Univer只在配置端按需加载，正式报表继续由VTable展示。具体依赖版本以package.json和锁文件为准。

React18升级不要求重写报表DSL、整体替换AntD/VTable或自动将计算放入Transition，也不改变现有模板源与发布模型的职责。升级相关历史实施记录中的版本和数量对应2026-10-19；当前模式二已下线，409项基线及现行入口见[最新实施验收](mode2-retirement-and-guided-editing-2026-10-28.md)。

## 2. 三方库API检查

下表为2026-10-19升级时的API检查记录，库版本列是当时观察，不代表最新安装版本。当前Univer已实测1.1.0，具体以锁文件为准；已完成项是实施背景，可选弃用清理按实际使用处理。

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

升级时采用effect初始化、独立子容器及微任务释放；后续SDK升级必须按安装版本重新验证接口和生命周期，不把在线文档当作本地版本证明。[Univer React集成](https://docs.univer.ai/guides/sheets/getting-started/integrations/react)、[依赖版本一致性要求](https://docs.univer.ai/guides/sheets/getting-started/installation)。

## 3. 回归范围

以下为原R18-T用例规范，保留以便复验；不是一次新的逐项运行声明。

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

## 4. 升级实施历史（2026-10-19）

### 4.1 依赖对齐与锁文件收敛 (R18-01 / R18-T01)
1. **`micro-bi/package.json`**:
   - `peerDependencies`: `"react": "^18.3.1"`, `"react-dom": "^18.3.1"`, `"antd": ">=5.24.0 <6"`, `"@univerjs/core": ">=1.0.4"`, `"@univerjs/preset-sheets-core": ">=1.0.4"`, `"@univerjs/presets": ">=1.0.4"`。
   - `devDependencies`: `"react": "18.3.1"`, `"react-dom": "18.3.1"`, `"@types/react": "^18.3.31"`, `"@types/react-dom": "^18.3.7"`。
   - 同步重建 `package-lock.json`（根包名修正为 `micro-bi`，移除旧 `echarts` 残留，完整收敛 Univer 1.0.4 与 RxJS 7.8.1）。
2. **`dynamic-data-test/package.json`**:
   - 依赖严格锁定为 React / ReactDOM 18.3.1 与 `@types/react@^18.3.31`、`@types/react-dom@^18.3.7`。
   - 显式声明 `@univerjs/core`、`@univerjs/preset-sheets-core`、`@univerjs/presets`、`rxjs` 并完成 `npm install` 锁定。
3. **两端 `npm ls react react-dom @types/react @types/react-dom`**:
   - 退出码均严格为 0，彻底消除之前由 17/18 声明与安装不一致引起的 `ELSPROBLEMS`（0 unmet, 0 invalid）。

### 4.2 核心代码加固 (R18-03 ~ R18-06)
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

### 4.3 全量自动化测试与验收结果 (280/280 PASS, 0 FAIL)
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
