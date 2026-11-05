# 仅拖拽排序、工作表公式编辑与自定义表头显示修复

本轮处理用户截图中的三项问题：移除指标上下移动按钮；D5工作表公式支持双击原生编辑；D3手工文字不能被时间表头的自动合并遮住。继续打通设计态、动态预览、保存重开和VTable。

## 交互调整

左侧排序只保留已选指标前方的拖拽手柄。勾选、全选、排序保存及撤销重做沿用第73节的源配置逻辑。

| 单元格 | 设计态双击 | 其他入口 |
| --- | --- | --- |
| 数据区外空白格、生成的可编辑表头/指标名称 | 原生输入 | F2原生输入 |
| 工作表公式，例如D5的`=IF(C5>100,1,2)` | 原生编辑公式 | F2同样编辑；右键“高级配置”调整结果属性和条件规则 |
| 普通静态文本、标题 | 现有内容/合并范围配置 | F2直接编辑文字 |
| 绑定维度、指标及业务公式 | 现有业务高级配置 | 内容和结构继续受控 |
| 动态预览 | 保持只读及既有下钻 | 不显示公式高级编辑菜单 |

工作表公式原来的高级面板用于配置计算结果，不能编辑公式表达式。将它继续放在双击入口会与原生编辑习惯冲突，因此双击统一交给Univer。结果高级配置通过Univer原生右键菜单保留；菜单只对设计态有公式的源格出现，空白格不出现。

## D3被覆盖的原因与修复

新增D5公式后，原型会依据它继承的列维度上下文扩宽。时间驱动格C3的真实覆盖范围随之成为C3:D3。原自动分组覆盖规则直接合并这个范围，虽然D3仍保存“自定义”，显示时却被主格C3遮住。

现在自动group-span合并在应用前检查：候选范围内若有其他源格的手工文本、工作表公式，或显式改名的生成文字，则不应用该候选合并。C3保留月份，D3保留自定义文字。其他没有冲突的分组/时间表头仍可自动合并。

该检查按行、列建立索引，通过二分查找判断候选区域，避免为每个合并范围遍历全部展开公式。规则仍保持启用；D3清空后可以重新形成自动合并，用户明确取消的合并仍保持取消。手工明确设置的合并继续按其优先级处理。

D3按已有静态/范围配置显示，本轮不为它额外推断新的重复规则。

## 展开公式的相对引用

排查时同时发现，工作表公式虽然在多个设备、月份上展开，但各实例此前仍使用原始C5引用。现在只对继承了相应行/列上下文的实例应用Excel复制语义：

| 位置 | 实例公式 | C列/E列对应值 | 结果 |
| --- | --- | ---: | ---: |
| D5，设备A/11月 | `=IF(C5>100,1,2)` | 120 | 1 |
| F5，设备A/12月 | `=IF(E5>100,1,2)` | 40 | 2 |
| D7，设备B/11月 | `=IF(C7>100,1,2)` | 20 | 2 |
| F7，设备B/12月 | `=IF(E7>100,1,2)` | 190 | 1 |

`$C$5`固定两个轴，`C$5`只固定行，`$C5`只固定列；字符串中的“C5”和函数名保持。独立公式即使因数据区域变大而被推到页尾，也不会仅因位置移动而改变引用。

展开实例保存各自的派生公式，源模板仍只保留用户输入的一份表达式。求值及VTable发布继续使用已有纯TypeScript引擎，展示态不引入Univer。

## 实现位置

| 文件 | 修改 |
| --- | --- |
| `cell-designer/HybridCellDesigner.tsx` | 移除上下按钮、工作表公式双击分流、公式右键高级配置 |
| `report-template/cellCapabilities.ts` | 区分高级能力与双击入口 |
| `univer/adapter.ts` | 注册原生上下文菜单及选择/模式可见性，卸载时清理事件和命令 |
| `report-template/mergeResolver.ts` | 自动合并保护手工内容及改名，按行/列索引检查冲突 |
| `report-template/sheetFormulaEvaluator.ts` | 复用既有词法分析，偏移相对引用并保留绝对标记/字符串 |
| `report-template/cellExpansionEngine.ts` | 按实例的行列上下文应用偏移，向两端发布相同公式和值 |

## 验收

新增CFH单元格回归，包括双击分流、D3覆盖复现、数据增删/逆序/空数据及JSON重开、清空表头与取消合并、手工合并、二维实例计算、绝对/混合引用、独立页尾及拖拽排序组合。

真实宿主通过鼠标和键盘录入D3、D5，验证双击与F2修改、原生右键结果设置、空白/预览隐藏菜单、绑定指标仍双击高级配置、拖拽与公式迁移、双设备双月份、保存重开及VTable。

结果和截图见[检查记录](verification/formula-header-fix-2026-11-04/checks.json)。所有平台写请求使用隔离内存API，不改真实工程。

最终验收：主库 **618/618**（含CFH专项10项）、本场景真实操作 **15/15**、三类报表仅拖拽排序 **32/32**、完整宿主 **14/14**、原生输入/IME **12/12**通过，均无pageerror。ESM/CJS/声明、严格嵌入类型及生产SDK构建通过。

效果见[双设备双月份预览](verification/formula-header-fix-2026-11-04/preview.png)，排序界面见[明细](verification/formula-header-fix-2026-11-04/sorting/detail.png)、[分组](verification/formula-header-fix-2026-11-04/sorting/grouped.png)及[交叉](verification/formula-header-fix-2026-11-04/sorting/pivot.png)。

```powershell
cd micro-bi
npm test
npx tsc -p embedded/tsconfig.json --noEmit
cd ../webEditor
npm run prepare:micro-bi
# 按本机设置PLAYWRIGHT_MODULE、CHROME_PATH、MICRO_BI_HOST_URL。
node scripts/verify-micro-bi-custom-formula.cjs
node scripts/verify-micro-bi-measure-order.cjs
node scripts/verify-micro-bi-platform.cjs
node scripts/verify-micro-bi-cell-input.cjs
```

新场景脚本支持 `MICRO_BI_FORMULA_QA_OUTPUT` 和 `MICRO_BI_FORMULA_QA_SCREENSHOT` 输出证据。刷新页面重新打开配置后加载最新SDK。
