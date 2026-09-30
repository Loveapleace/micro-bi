/**
 * 国际化模版格式化工具
 */

/**
 * 将带有 `{key}` 占位符的模版文本替换为对应参数
 *
 * @example
 * formatMessage("总计 (共 {count} 项)", { count: 10 }) // => "总计 (共 10 项)"
 * formatMessage("Total ({count} items)", { count: 10 }) // => "Total (10 items)"
 */
export function formatMessage(
  template: string,
  params?: Readonly<Record<string, string | number | boolean | undefined | null>>
): string {
  if (!params || !template.includes('{')) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const val = params[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
}
