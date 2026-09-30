/**
 * 动态公式求值器 (Evaluator)
 *
 * 遍历 AST，结合单行上下文安全执行公式求值。
 */
import type { ASTNode } from './token.js';
import { parseFormula } from './parser.js';

export interface EvaluateOptions {
  /** 是否在数值计算中将 null/undefined 视作 0，默认 true */
  readonly nullAsZero?: boolean;
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.trim().length > 0 && value !== '0' && value.toLowerCase() !== 'false';
  return true;
}

function toNumber(val: unknown, nullAsZero: boolean): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (val === null || val === undefined || val === '') {
    return nullAsZero ? 0 : NaN;
  }
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : (nullAsZero ? 0 : NaN);
}

function compareValues(
  a: unknown,
  b: unknown,
  op: '>' | '<' | '>=' | '<=',
  nullAsZero: boolean
): boolean {
  // 1. 若任一为 Date 实例，按时间戳比对
  if (a instanceof Date || b instanceof Date) {
    const tA = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const tB = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
      switch (op) {
        case '>': return tA > tB;
        case '<': return tA < tB;
        case '>=': return tA >= tB;
        case '<=': return tA <= tB;
      }
    }
  }

  // 2. 若双方皆为纯数值或可解析为有效数字的字符串（如 "100" 与 "20"），严格按数值比对
  const isNumA = typeof a === 'number' || (typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a)));
  const isNumB = typeof b === 'number' || (typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b)));

  if (isNumA && isNumB) {
    const nA = toNumber(a, nullAsZero);
    const nB = toNumber(b, nullAsZero);
    switch (op) {
      case '>': return nA > nB;
      case '<': return nA < nB;
      case '>=': return nA >= nB;
      case '<=': return nA <= nB;
    }
  }

  // 3. 若双方皆为字符串（如 ISO 日期格式 '2026-08-01 10:00:00' 与 '2026-08-01 08:00:00'，或评级 'S' 与 'A'）
  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
  }

  // 4. 降级为数值比对
  const nA = toNumber(a, nullAsZero);
  const nB = toNumber(b, nullAsZero);
  switch (op) {
    case '>': return nA > nB;
    case '<': return nA < nB;
    case '>=': return nA >= nB;
    case '<=': return nA <= nB;
  }
}

export function evaluateAST(
  node: ASTNode,
  context: Readonly<Record<string, unknown>>,
  options: EvaluateOptions = { nullAsZero: true }
): unknown {
  const nullAsZero = options.nullAsZero ?? true;

  switch (node.kind) {
    case 'Literal':
      return node.value;

    case 'FieldRef': {
      let val = context[node.fieldName];
      if (val === undefined) {
        // 宏聚合别名兼容兜底：若在明细行公式中引用了 SUM(sales) 或 COUNT(id) 等聚合宏
        const aggMatch = /^(SUM|AVG|MIN|MAX|COUNT)\((.+)\)$/i.exec(node.fieldName);
        if (aggMatch && aggMatch[1] && aggMatch[2]) {
          const fn = aggMatch[1].toUpperCase();
          const innerField = aggMatch[2].trim();
          if (fn === 'COUNT') {
            return 1;
          }
          let innerVal = context[innerField];
          if (innerVal === undefined) {
            const innerLower = innerField.toLowerCase();
            for (const [k, v] of Object.entries(context)) {
              if (k.toLowerCase() === innerLower) {
                innerVal = v;
                break;
              }
            }
          }
          if (innerVal !== undefined) {
            return innerVal;
          }
        }

        // 大小写不敏感查找兜底，提升公式兼容度
        const targetLower = node.fieldName.toLowerCase();
        for (const [k, v] of Object.entries(context)) {
          if (k.toLowerCase() === targetLower) {
            val = v;
            break;
          }
        }
      }
      return val;
    }

    case 'UnaryOp': {
      const argVal = evaluateAST(node.argument, context, options);
      if (node.operator === '!') {
        return !isTruthy(argVal);
      }
      if (node.operator === '-') {
        return -toNumber(argVal, nullAsZero);
      }
      if (node.operator === '+') {
        return toNumber(argVal, nullAsZero);
      }
      return argVal;
    }

    case 'BinaryOp': {
      // 逻辑短路
      if (node.operator === '&&') {
        const leftVal = evaluateAST(node.left, context, options);
        if (!isTruthy(leftVal)) return false;
        const rightVal = evaluateAST(node.right, context, options);
        return isTruthy(rightVal);
      }
      if (node.operator === '||') {
        const leftVal = evaluateAST(node.left, context, options);
        if (isTruthy(leftVal)) return true;
        const rightVal = evaluateAST(node.right, context, options);
        return isTruthy(rightVal);
      }

      const leftVal = evaluateAST(node.left, context, options);
      const rightVal = evaluateAST(node.right, context, options);

      switch (node.operator) {
        case '+': {
          // 字符串拼接 vs 数值相加
          if (typeof leftVal === 'string' || typeof rightVal === 'string') {
            return String(leftVal ?? '') + String(rightVal ?? '');
          }
          return toNumber(leftVal, nullAsZero) + toNumber(rightVal, nullAsZero);
        }
        case '-':
          return toNumber(leftVal, nullAsZero) - toNumber(rightVal, nullAsZero);
        case '*':
          return toNumber(leftVal, nullAsZero) * toNumber(rightVal, nullAsZero);
        case '/': {
          const divisor = toNumber(rightVal, nullAsZero);
          if (divisor === 0) return 0; // 防除以 0 容错
          return toNumber(leftVal, nullAsZero) / divisor;
        }
        case '%': {
          const divisor = toNumber(rightVal, nullAsZero);
          if (divisor === 0) return 0;
          return toNumber(leftVal, nullAsZero) % divisor;
        }
        case '==':
          return leftVal == rightVal; // 宽泛相等以支持数值与字符型数字比对
        case '!=':
          return leftVal != rightVal;
        case '>':
        case '<':
        case '>=':
        case '<=':
          return compareValues(leftVal, rightVal, node.operator, nullAsZero);
        default:
          return null;
      }
    }

    case 'If': {
      const condVal = evaluateAST(node.condition, context, options);
      if (isTruthy(condVal)) {
        return evaluateAST(node.consequent, context, options);
      } else {
        return evaluateAST(node.alternate, context, options);
      }
    }

    case 'Call': {
      const fn = node.functionName;
      const evaluatedArgs = node.args.map((arg) => evaluateAST(arg, context, options));

      switch (fn) {
        case 'ROUND': {
          const num = toNumber(evaluatedArgs[0], nullAsZero);
          const precision = toNumber(evaluatedArgs[1] ?? 0, false);
          const factor = 10 ** (precision || 0);
          return Math.round(num * factor) / factor;
        }
        case 'ABS':
          return Math.abs(toNumber(evaluatedArgs[0], nullAsZero));
        case 'COALESCE': {
          for (const a of evaluatedArgs) {
            if (a !== null && a !== undefined && a !== '') return a;
          }
          return null;
        }
        case 'CONCAT':
          return evaluatedArgs.map((a) => String(a ?? '')).join('');
        case 'UPPER':
          return String(evaluatedArgs[0] ?? '').toUpperCase();
        case 'LOWER':
          return String(evaluatedArgs[0] ?? '').toLowerCase();
        default:
          return null;
      }
    }
  }
}

/**
 * 快速解析并求值公式
 */
export function evaluateFormula(
  expression: string,
  context: Readonly<Record<string, unknown>>,
  options?: EvaluateOptions
): unknown {
  const ast = parseFormula(expression);
  return evaluateAST(ast, context, options);
}
