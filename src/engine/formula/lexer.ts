/**
 * 动态公式词法分析器 (Lexer)
 */
import type { Token, TokenType } from './token.js';

export class LexerError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`词法解析错误 (位置 ${position}): ${message}`);
    this.name = 'LexerError';
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (ch === undefined) break;

    // 1. 跳过空白字符
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const startPos = i;

    // 2. 字段引用: [字段名] 或 [SUM(sales)]
    if (ch === '[') {
      let fieldName = '';
      i++; // 跳过 '['
      while (i < len && input[i] !== ']') {
        fieldName += input[i];
        i++;
      }
      if (i >= len || input[i] !== ']') {
        throw new LexerError('未闭合的字段引用，缺少 "]"', startPos);
      }
      i++; // 跳过 ']'
      tokens.push({
        type: 'FIELD',
        value: fieldName.trim(),
        position: startPos,
      });
      continue;
    }

    // 3. 字符串字面量: 'abc' 或 "def"
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      let str = '';
      i++;
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < len) {
          i++;
          str += input[i];
        } else {
          str += input[i];
        }
        i++;
      }
      if (i >= len || input[i] !== quote) {
        throw new LexerError(`未闭合的字符串字面量，缺少 ${quote}`, startPos);
      }
      i++; // 跳过结束引号
      tokens.push({
        type: 'STRING',
        value: str,
        position: startPos,
      });
      continue;
    }

    // 4. 数字字面量: 123 或 45.67
    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(input[i + 1] ?? ''))) {
      let numStr = '';
      let hasDot = false;
      while (i < len) {
        const cur = input[i] ?? '';
        if (/\d/.test(cur)) {
          numStr += cur;
          i++;
        } else if (cur === '.' && !hasDot) {
          hasDot = true;
          numStr += cur;
          i++;
        } else {
          break;
        }
      }
      tokens.push({
        type: 'NUMBER',
        value: numStr,
        position: startPos,
      });
      continue;
    }

    // 5. 双字符运算符: >=, <=, ==, !=, <>, &&, ||
    const twoChars = input.slice(i, i + 2);
    if (twoChars === '>=' || twoChars === '<=' || twoChars === '==' || twoChars === '!=' || twoChars === '<>') {
      tokens.push({
        type: 'COMPARISON',
        value: twoChars === '<>' ? '!=' : twoChars,
        position: startPos,
      });
      i += 2;
      continue;
    }
    if (twoChars === '&&' || twoChars === '||') {
      tokens.push({
        type: 'LOGICAL',
        value: twoChars,
        position: startPos,
      });
      i += 2;
      continue;
    }

    // 6. 单字符比较或逻辑: >, <, =
    if (ch === '>' || ch === '<') {
      tokens.push({
        type: 'COMPARISON',
        value: ch,
        position: startPos,
      });
      i++;
      continue;
    }
    if (ch === '=') {
      // 允许单个 '=' 视作 '==' 比较以方便用户输入
      tokens.push({
        type: 'COMPARISON',
        value: '==',
        position: startPos,
      });
      i++;
      continue;
    }
    if (ch === '!') {
      tokens.push({
        type: 'LOGICAL',
        value: '!',
        position: startPos,
      });
      i++;
      continue;
    }

    // 7. 四则运算符: +, -, *, /, %
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      tokens.push({
        type: 'OPERATOR',
        value: ch,
        position: startPos,
      });
      i++;
      continue;
    }

    // 8. 标点符号: (, ), ,
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: startPos });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: startPos });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', position: startPos });
      i++;
      continue;
    }

    // 9. 标识符 / 函数名 / 英文关键字 (如 IF, AND, OR, NOT, TRUE, FALSE, ROUND, ABS)
    if (/[a-zA-Z_\u4e00-\u9fa5]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(input[i] ?? '')) {
        ident += input[i];
        i++;
      }
      const upper = ident.toUpperCase();
      if (upper === 'AND' || upper === 'OR') {
        tokens.push({
          type: 'LOGICAL',
          value: upper === 'AND' ? '&&' : '||',
          position: startPos,
        });
      } else if (upper === 'NOT') {
        tokens.push({
          type: 'LOGICAL',
          value: '!',
          position: startPos,
        });
      } else if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({
          type: 'BOOLEAN',
          value: upper,
          position: startPos,
        });
      } else {
        tokens.push({
          type: 'IDENTIFIER',
          value: upper,
          position: startPos,
        });
      }
      continue;
    }

    throw new LexerError(`无法识别的字符: '${ch}'`, startPos);
  }

  tokens.push({ type: 'EOF', value: '', position: len });
  return tokens;
}
