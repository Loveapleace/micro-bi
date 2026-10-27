# 旧条件字段不再校验或阻断

日期：2026-10-27。状态：已修改并回归。对应用户截图及整改清单第39节。

旧conditionalRules/conditionRules直接忽略，不校验、不执行、不迁移。未配置新presentationRules时按无条件规则处理；已配置新规则时，只校验和执行新模型。报表正常的字段、公式、合并及新规则有效性检查保留。

## 原因与修改

此前有两层拦截：共享规则校验器检查旧字段是否存在并返回ERR_UNSUPPORTED_CONDITIONAL_CONFIG；HybridCellDesigner还单独检查initialDocument，把该错误加入预览屏障并在保存时抛出。即使当前生成模板已使用新结构，初始报表残留旧字段仍会触发截图中的横幅。

本次移除两层旧字段检测及其错误分支，未新增兼容器，也不把旧规则转换为新规则。

| 文件 | 修改 |
| --- | --- |
| src/report-template/presentationRules.ts | 删除旧根/单格/content条件字段存在性校验，仅校验presentationRules |
| src/cell-designer/HybridCellDesigner.tsx | 删除initialRuleErrors及其预览/保存拦截，继续使用当前模板正常校验 |
| test/presentation-rules.test.mjs | CR-27保留新模型非法输入检查；增加CR-41/42检查旧字段忽略及新旧并存往返 |

## 验收

- 全库**373/373通过**，其中条件规则专项42项。
- 库ESM/CJS及声明、宿主TypeScript/Vite构建通过。
- 旧字段含空数组、非空规则、null或非法对象，均不阻断；未提供新模型时没有旧文案或旧样式执行。
- 新旧字段并存时，新规则仍得到5低产、4关注、4正常；新模型的非法颜色、版本、操作符、占位符继续报错。
- 实际原模式三入口的两组浏览器回归通过：只含旧字段、新旧字段并存，均可预览、保存、刷新、重开并由VTable展示；无旧字段报错横幅，pageerror为0。

浏览器使用独立上下文，加载带旧字段的固定测试看板。只含旧字段的报表保存后有0条新规则；混合报表保存重开保留3条新规则，预览和VTable状态均为5/4/4。未修改用户原浏览器看板存储。

证据：[浏览器记录](verification/ignore-legacy-conditional-fields-2026-10-27/browser.json)、[预览不再拦截](verification/ignore-legacy-conditional-fields-2026-10-27/verified-1-preview.png)、[新旧并存预览](verification/ignore-legacy-conditional-fields-2026-10-27/verified-2-preview.png)、[构建/测试和源码指纹](verification/ignore-legacy-conditional-fields-2026-10-27/checks.json)。

复验：先运行`npm run build`和`npm run test:only`。宿主开发服务在5174运行时，可从项目根执行`node scripts/verify-legacy-conditional-fields.mjs`；固定输入位于`test/fixtures/legacy-conditional-browser.json`。
