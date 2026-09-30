/**
 * 动态公式语法分析器 (Parser)
 *
 * 将 Token 序列解析为抽象语法树 (AST)。
 */
import type { ASTNode, Token, TokenType } from './token.js';
import { tokenize } from './lexer.js';

export class ParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`公式语法错误 (位置 ${position}): ${message}`);
    this.name = 'ParseError';
  }
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  public parse(): ASTNode {
    if (this.isAtEnd() || this.peek().type === 'EOF') {
      throw new ParseError('公式表达式不能为空', 0);
    }
    const node = this.expression();
    if (!this.isAtEnd() && this.peek().type !== 'EOF') {
      const extra = this.peek();
      throw new ParseError(`无法解析多余的内容: "${extra.value}"`, extra.position);
    }
    return node;
  }

  private expression(): ASTNode {
    return this.logicalOr();
  }

  // logicalOr -> logicalAnd ( '||' logicalAnd )*
  private logicalOr(): ASTNode {
    let expr = this.logicalAnd();
    while (this.matchValue('LOGICAL', '||')) {
      const op = this.previous().value;
      const right = this.logicalAnd();
      expr = { kind: 'BinaryOp', operator: op, left: expr, right };
    }
    return expr;
  }

  // logicalAnd -> comparison ( '&&' comparison )*
  private logicalAnd(): ASTNode {
    let expr = this.comparison();
    while (this.matchValue('LOGICAL', '&&')) {
      const op = this.previous().value;
      const right = this.comparison();
      expr = { kind: 'BinaryOp', operator: op, left: expr, right };
    }
    return expr;
  }

  // comparison -> additive ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) additive )*
  private comparison(): ASTNode {
    let expr = this.additive();
    while (this.matchType('COMPARISON')) {
      const op = this.previous().value;
      const right = this.additive();
      expr = { kind: 'BinaryOp', operator: op, left: expr, right };
    }
    return expr;
  }

  // additive -> multiplicative ( ( '+' | '-' ) multiplicative )*
  private additive(): ASTNode {
    let expr = this.multiplicative();
    while (this.matchValue('OPERATOR', '+') || this.matchValue('OPERATOR', '-')) {
      const op = this.previous().value;
      const right = this.multiplicative();
      expr = { kind: 'BinaryOp', operator: op, left: expr, right };
    }
    return expr;
  }

  // multiplicative -> unary ( ( '*' | '/' | '%' ) unary )*
  private multiplicative(): ASTNode {
    let expr = this.unary();
    while (
      this.matchValue('OPERATOR', '*') ||
      this.matchValue('OPERATOR', '/') ||
      this.matchValue('OPERATOR', '%')
    ) {
      const op = this.previous().value;
      const right = this.unary();
      expr = { kind: 'BinaryOp', operator: op, left: expr, right };
    }
    return expr;
  }

  // unary -> ( '!' | '-' | '+' ) unary | primary
  private unary(): ASTNode {
    if (this.matchValue('LOGICAL', '!') || this.matchValue('OPERATOR', '-') || this.matchValue('OPERATOR', '+')) {
      const op = this.previous().value;
      const arg = this.unary();
      return { kind: 'UnaryOp', operator: op, argument: arg };
    }
    return this.primary();
  }

  // primary -> NUMBER | STRING | BOOLEAN | FIELD | IDENTIFIER '(' args? ')' | '(' expr ')'
  private primary(): ASTNode {
    const token = this.peek();

    // 1. 数字
    if (this.matchType('NUMBER')) {
      return { kind: 'Literal', value: Number(this.previous().value) };
    }

    // 2. 字符串
    if (this.matchType('STRING')) {
      return { kind: 'Literal', value: this.previous().value };
    }

    // 3. 布尔
    if (this.matchType('BOOLEAN')) {
      return { kind: 'Literal', value: this.previous().value.toUpperCase() === 'TRUE' };
    }

    // 4. 字段引用 [field]
    if (this.matchType('FIELD')) {
      return { kind: 'FieldRef', fieldName: this.previous().value };
    }

    // 5. 括号分组 ( expr )
    if (this.matchType('LPAREN')) {
      const expr = this.expression();
      this.consume('RPAREN', '缺少闭合括号 ")"');
      return expr;
    }

    // 6. 函数调用，如 IF(cond, a, b) 或 ROUND(x, 2)
    if (this.matchType('IDENTIFIER')) {
      const fnName = this.previous().value.toUpperCase();
      this.consume('LPAREN', `函数 ${fnName} 后面缺少 "("`);
      const args: ASTNode[] = [];
      if (!this.check('RPAREN')) {
        do {
          args.push(this.expression());
        } while (this.matchType('COMMA'));
      }
      this.consume('RPAREN', `函数 ${fnName} 参数列表缺少闭合 ")"`);

      if (fnName === 'IF') {
        if (args.length !== 3) {
          throw new ParseError(`IF 函数需要正好 3 个参数，当前传入了 ${args.length} 个`, token.position);
        }
        const condition = args[0];
        const consequent = args[1];
        const alternate = args[2];
        if (!condition || !consequent || !alternate) {
          throw new ParseError('IF 函数参数不能为空', token.position);
        }
        return {
          kind: 'If',
          condition,
          consequent,
          alternate,
        };
      }

      return {
        kind: 'Call',
        functionName: fnName,
        args,
      };
    }

    throw new ParseError(`意外的标记: "${token.value || token.type}"`, token.position);
  }

  private matchType(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchValue(type: TokenType, value: string): boolean {
    if (this.check(type) && this.peek().value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length || this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current] ?? { type: 'EOF', value: '', position: 0 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1] ?? { type: 'EOF', value: '', position: 0 };
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const pos = this.peek().position;
    throw new ParseError(message, pos);
  }
}

const MAX_AST_CACHE_SIZE = 500;
const astCache = new Map<string, ASTNode>();

/**
 * 解析公式文本为 AST 抽象语法树（具备内存 AST 缓存，彻底消除行级循环内数十万次重复解析开销）
 */
export function parseFormula(expression: string): ASTNode {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new ParseError('公式表达式不能为空', 0);
  }
  const cached = astCache.get(trimmed);
  if (cached) {
    return cached;
  }
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  const ast = parser.parse();

  if (astCache.size >= MAX_AST_CACHE_SIZE) {
    const firstKey = astCache.keys().next().value;
    if (firstKey !== undefined) {
      astCache.delete(firstKey);
    }
  }
  astCache.set(trimmed, ast);
  return ast;
}

/** 清空公式 AST 缓存（供测试或热重载调用） */
export function clearAstCache(): void {
  astCache.clear();
}

/**
 * 递归遍历 AST，提取所引用的全部字段名（保持无重复）
 */
export function extractReferencedFields(node: ASTNode): readonly string[] {
  const fields = new Set<string>();

  function walk(n: ASTNode) {
    switch (n.kind) {
      case 'FieldRef':
        fields.add(n.fieldName);
        break;
      case 'BinaryOp':
        walk(n.left);
        walk(n.right);
        break;
      case 'UnaryOp':
        walk(n.argument);
        break;
      case 'If':
        walk(n.condition);
        walk(n.consequent);
        walk(n.alternate);
        break;
      case 'Call':
        for (const arg of n.args) {
          walk(arg);
        }
        break;
      case 'Literal':
        break;
    }
  }

  walk(node);
  return Array.from(fields);
}
