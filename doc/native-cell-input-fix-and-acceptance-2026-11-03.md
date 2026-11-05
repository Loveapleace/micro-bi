# 配置态双击/F2无法输入：修复与验收

用户反馈自动生成的表头、指标名称和数据区域外空白格进入编辑后无法输入。本轮通过真实宿主页面复现并修复，原有受控区域规则保持。

## 原因

双击和F2都可以触发原生 `BeforeSheetEditStart`，可编辑格未被业务保护取消。键盘事件也能到达Univer原生contenteditable，但空输入元素的实际布局尺寸为 **0×0**。此状态下浏览器没有产生 `beforeinput/input` 事件，因此能够看到画布光标，却没有文字进入原生文档模型。

在同一隔离页面中，仅给原生输入元素增加最小1px宽高后，真实键盘和中文输入法恢复工作，保留原有负z-index也能正常输入。问题不属于字符、长度或数据类型限制。

之前部分验收采用Facade/API写值，覆盖了配置保存与展示，未充分覆盖浏览器真实文字输入。此次补充独立指针、键盘与IME回归，不以 `setValue` 成功作为输入有效的证据。

## 修改

`src/univer/UniverPreview.tsx` 在组件作用域内设置：

```css
[data-univer-state] [data-u-comp="editor"][contenteditable="true"] {
  min-width: 1px;
  min-height: 1px;
}
```

只约束报表编辑器内的原生输入元素，不改输入内容、不接管字符事件、不使用自定义文本框，不修改node_modules。输入元素的定位、透明文本、层级、光标、组合输入和实际大小继续由Univer维护。公式栏输入在原生激活后移动到编辑器根内，同样适用。

原有编辑边界不变：

| 位置/状态 | 行为 |
| --- | --- |
| 模板设计态、数据区外空白格 | 双击或F2原生输入 |
| 生成的表头及指标标签 | 双击或F2修改文字，字段/指标身份保持 |
| 已有静态文字、标题 | 继续保留内容/范围高级配置；F2原生编辑 |
| 字段绑定格、受控数据格 | 内容由左侧面板生成，禁止原生覆盖 |
| 动态展开预览 | 内容只读，继续支持已有下钻及合并机制 |

本轮没有新增长度限制，也没有放开受控数据区域。

## 验收

使用真实webEditor/hwComponent/生产构建的嵌入SDK，API后端为隔离内存fixture，不修改真实项目。原始样本先取同一车间和日期的4条事实，确保E8同时处于模板及实际展开数据区域之外，随后新增车间/日期验收动态变化。

| 用例 | 结果 |
| --- | --- |
| 空白E8双击，逐键输入英文和数字 | `Alpha123`提交成功，确认产生真实beforeinput事件，输入面积至少1×1 |
| 空白E9按F2，原生IME组合输入 | 通过CDP的imeSetComposition/insertText触发compositionstart/end，保存完整“中文输入” |
| 连续F2修改及Esc取消 | 追加后得到`Alpha123-again`，取消下一次编辑不覆盖已提交值 |
| 自动表头A3/B3 | 分别双击/F2改为“承制车间”“统计指标”，不弹高级配置 |
| 指标标签B4/B5 | 分别双击/F2改名，qty仍是原字段及指标绑定 |
| 空白F10输入`=1+2` | 模板保留sheet-formula及表达式，预览计算为3 |
| 公式栏直接输入 | `FormulaBarInput`正常提交，使用同一原生输入尺寸修复 |
| 对绑定指标格F2输入999 | 原受控内容保持，未允许直接覆盖绑定 |
| 切换动态预览及返回模板 | 静态内容和公式保留，预览内输入被拒绝 |
| 保存并由VTable展示 | 表头、指标名称、中英文内容和公式保持，字段身份未改变 |
| 保存重开与关闭 | 内容恢复，重开后F2仍可输入，关闭清理Univer API |
| 工程发布重载，新增车间/透视日期 | 编辑内容保留，新成员及新增指标值正常展示 |

12项真实输入检查通过，完整宿主14项浏览器回归通过；空白编辑、生成标签、受控保护35项既有测试通过；严格嵌入包类型检查及主库ESM/CJS/声明构建通过。模板设计态按既有约定显示公式表达式，动态预览及展示态显示计算结果。本轮变更仅涉及SDK及验证脚本，未重复构建未修改源码的宿主Webpack主包。

宿主完整回归继续使用 `webEditor/scripts/verify-micro-bi-platform.cjs`；新增 `webEditor/scripts/verify-micro-bi-cell-input.cjs` 复用其隔离fixture，避免复制平台接口模拟。

复验时先运行 `webEditor` 的 `npm run prepare:micro-bi`。按环境设置 `PLAYWRIGHT_MODULE`、`CHROME_PATH` 和 `MICRO_BI_HOST_URL` 后执行：

```powershell
node scripts/verify-micro-bi-cell-input.cjs
node scripts/verify-micro-bi-platform.cjs
```

`MICRO_BI_SDK_ASSET_DIR` 可指定生产SDK资源目录；`MICRO_BI_INPUT_QA_OUTPUT` 指定输入验收JSON，`MICRO_BI_INPUT_QA_SCREENSHOT` 可保存预览截图。提交后的值按原生异步命令完成状态等待，不依赖任意固定延时。

证据见[输入回归](verification/native-cell-input-2026-11-03/input-checks.json)及[宿主回归](verification/native-cell-input-2026-11-03/platform-checks.json)。开发服务已重新生成并加载新SDK；已打开的编辑器需要关闭并刷新页面后重新打开，以使用新资源。
