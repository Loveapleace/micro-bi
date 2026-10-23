/**
 * 纯手工算术表达式求值器 (arithmeticEval.ts)
 * 零 eval / 零 new Function，仅支持由数字、空白、加、减、乘、除、取模、括号与点号构成的表达式。
 * 支持：字面量数字、一元正负号、四则与取模、括号分组。
 * 调用方需自行保证输入已通过白名单正则校验。
 *
 * 返回值语义：
 * - 合法且有限的数值 -> number；
 * - 除以零 / 模零 -> Infinity / NaN（由调用方据此判定除零错误）；
 * - 语法非法或存在未消费内容 -> null。
 */
export function evaluateArithmetic(expression: string): number | null {
  const src = expression;
  let pos = 0;

  const skipWs = (): void => {
    while (pos < src.length && /\s/.test(src[pos] ?? '')) pos++;
  };

  const parseExpression = (): number | null => parseAdditive();

  const parseAdditive = (): number | null => {
    let left = parseMultiplicative();
    if (left === null) return null;
    for (;;) {
      skipWs();
      const ch = src[pos];
      if (ch === '+' || ch === '-') {
        pos++;
        const right = parseMultiplicative();
        if (right === null) return null;
        left = ch === '+' ? left + right : left - right;
      } else {
        return left;
      }
    }
  };

  const parseMultiplicative = (): number | null => {
    let left = parseUnary();
    if (left === null) return null;
    for (;;) {
      skipWs();
      const ch = src[pos];
      if (ch === '*' || ch === '/' || ch === '%') {
        pos++;
        const right = parseUnary();
        if (right === null) return null;
        if (ch === '*') {
          left = left * right;
        } else if (ch === '/') {
          left = left / right; // 0 为除数时产出 Infinity，交由调用方处理
        } else {
          left = left % right; // 0 为除数时产出 NaN，交由调用方处理
        }
      } else {
        return left;
      }
    }
  };

  const parseUnary = (): number | null => {
    skipWs();
    const ch = src[pos];
    if (ch === '+') {
      pos++;
      return parseUnary();
    }
    if (ch === '-') {
      pos++;
      const v = parseUnary();
      return v === null ? null : -v;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    skipWs();
    const ch = src[pos];
    if (ch === '(') {
      pos++;
      const v = parseExpression();
      skipWs();
      if (src[pos] !== ')') return null;
      pos++;
      return v;
    }
    if (ch && /\d/.test(ch)) {
      let numStr = '';
      let hasDot = false;
      while (pos < src.length) {
        const cur = src[pos] ?? '';
        if (/\d/.test(cur)) {
          numStr += cur;
          pos++;
        } else if (cur === '.' && !hasDot) {
          hasDot = true;
          numStr += cur;
          pos++;
        } else {
          break;
        }
      }
      const num = Number(numStr);
      return Number.isNaN(num) ? null : num;
    }
    return null;
  };

  skipWs();
  const result = parseExpression();
  if (result === null) return null;
  skipWs();
  if (pos < src.length) return null; // 存在未消费的非法内容
  return result;
}
