/**
 * 纯 TS 电子表格公式求值器 (sheetFormulaEvaluator.ts)
 * 零 eval / 零 new Function，递归下降语法分析与安全求值。
 *
 * 核心能力：
 * 1. 单元格坐标：A1, B2, $B$2, B$2, $B2, AA10（不区分大小写，支持绝对/相对引用）
 * 2. 矩形连续区域：A1:B5, B2:C2, $A$1:$B$5（自动展平为单元格数值集合）
 * 3. 聚合函数：SUM, AVERAGE, AVG, MAX, MIN, COUNT, COUNTA, PRODUCT（支持范围参数、多参数、混选参数）
 * 4. 数学函数：ROUND, ROUNDUP, ROUNDDOWN, ABS, INT, MOD, POWER, SQRT, CEIL, CEILING, FLOOR
 * 5. 逻辑与分支：IF, IFS, AND, OR, NOT, IFERROR, COALESCE, IFNULL, ISBLANK, ISNUMBER, ISTEXT
 * 6. 文本处理：CONCAT, CONCATENATE, LEFT, RIGHT, MID, LEN, UPPER, LOWER, TRIM, TEXT, VALUE
 * 7. 运算符：四则 (+, -, *, /), 幂 (^), 模 (%), 百分比 (50%, B2%), 比较 (=, ==, !=, <>, <, <=, >, >=), 拼接 (&)
 * 8. 复合嵌套表达式：=MAX(B2, C2) * 2, =IF(MAX(B2,C2) > 2, SUM(B2:C2), 0)
 */

import { formatExcelValue, isValidNumberFormat } from '../report/numberFormat.js';
const sheetErrors = new Set(['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#NULL!', '#SPILL!', '#CALC!', '#ERROR!']);
const isSheetError = (value: unknown): value is string => typeof value === 'string' && sheetErrors.has(value);

export interface CellAccessor {
  (row: number, col: number): any;
}

export interface SheetFormulaResult {
  value: any;
  error?: string;
}

export function colLetterToIndex(colStr: string): number {
  let index = 0;
  const s = colStr.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    index = index * 26 + (s.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function indexToColLetter(index: number): string {
  let col = '';
  let temp = index + 1;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    col = String.fromCharCode(65 + mod) + col;
    temp = Math.floor((temp - mod) / 26);
  }
  return col;
}

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'CELL'
  | 'IDENT'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'COLON'
  | 'PERCENT'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenizeFormula(input: string): Token[] {
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

    // 2. 字符串字面量: "hello" 或 'hello'
    if (ch === '"' || ch === '\'') {
      const quote = ch;
      let str = '';
      i++;
      while (i < len) {
        if (input[i] === quote) {
          if (i + 1 < len && input[i + 1] === quote) {
            str += quote;
            i += 2;
          } else {
            i++;
            break;
          }
        } else if (input[i] === '\\' && i + 1 < len) {
          i++;
          str += input[i];
          i++;
        } else {
          str += input[i];
          i++;
        }
      }
      tokens.push({ type: 'STRING', value: str, pos: startPos });
      continue;
    }

    // 3. 数字字面量: 123, 45.67, .5
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
      tokens.push({ type: 'NUMBER', value: numStr, pos: startPos });
      continue;
    }

    // 4. 双字符运算符: <=, >=, <>, !=, ==, &&, ||
    const two = input.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(two)) {
      tokens.push({ type: 'OP', value: two === '<>' ? '!=' : two, pos: startPos });
      i += 2;
      continue;
    }

    // 5. 标点符号与单字符运算符
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: startPos });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: startPos });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', pos: startPos });
      i++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'COLON', value: ':', pos: startPos });
      i++;
      continue;
    }
    if (ch === '%') {
      tokens.push({ type: 'PERCENT', value: '%', pos: startPos });
      i++;
      continue;
    }

    if (['+', '-', '*', '/', '^', '&', '<', '>', '='].includes(ch)) {
      tokens.push({ type: 'OP', value: ch === '=' ? '==' : ch, pos: startPos });
      i++;
      continue;
    }

    // 6. 标识符或单元格坐标 (如 $B$2, B2, MAX, IF)
    if (ch === '$' || /[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      let ident = '';
      while (i < len && (input[i] === '$' || /[A-Za-z0-9_\u4e00-\u9fa5]/.test(input[i] ?? ''))) {
        ident += input[i];
        i++;
      }

      // 查看后续非空字符是否紧随 '(' -> 是则必为函数调用
      let peekIdx = i;
      while (peekIdx < len && /\s/.test(input[peekIdx] ?? '')) peekIdx++;
      const nextNonWs = peekIdx < len ? input[peekIdx] : '';

      if (nextNonWs === '(') {
        tokens.push({ type: 'IDENT', value: ident.toUpperCase(), pos: startPos });
        continue;
      }

      // 判定是否符合单元格坐标规范: $?[A-Za-z]{1,3}\$?\d+
      const cellMatch = /^\$?([A-Za-z]{1,3})\$?(\d+)$/i.exec(ident);
      if (cellMatch) {
        tokens.push({ type: 'CELL', value: ident.toUpperCase(), pos: startPos });
        continue;
      }

      const upper = ident.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'BOOLEAN', value: upper, pos: startPos });
      } else {
        tokens.push({ type: 'IDENT', value: upper, pos: startPos });
      }
      continue;
    }

    tokens.push({ type: 'OP', value: ch, pos: startPos });
    i++;
  }

  tokens.push({ type: 'EOF', value: '', pos: i });
  return tokens;
}

export interface FormulaCellPosition { row: number; col: number }
/** Copy semantics for an expanded formula instance; $ pins only the corresponding row/column. */
export function offsetSheetFormulaReferences(formula: string, columnOffset: number, rowOffset: number): string {
  if (!columnOffset && !rowOffset) return formula;
  const edits = tokenizeFormula(formula).filter(token => token.type === 'CELL').map(token => {
    const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(token.value)!;
    const col = colLetterToIndex(match[2]!) + (match[1] ? 0 : columnOffset), row = Number(match[4]) - 1 + (match[3] ? 0 : rowOffset);
    return { start: token.pos, end: token.pos + token.value.length,
      text: col < 0 || row < 0 ? '#REF!' : `${match[1]}${indexToColLetter(col)}${match[3]}${row + 1}` };
  });
  let result = formula;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
/** Use the evaluator's tokenizer so quoted text and function names cannot be mistaken for A1 references. */
export function relocateSheetFormulaReferences(formula: string, moves: ReadonlyMap<string, FormulaCellPosition>): string {
  const tokens = tokenizeFormula(formula), edits: { start: number; end: number; text: string }[] = [];
  const position = (token: Token): FormulaCellPosition => {
    const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.value)!;
    return { row: Number(match[2]) - 1, col: colLetterToIndex(match[1]!) };
  };
  const key = (p: FormulaCellPosition) => `${p.row}:${p.col}`;
  const reference = (token: Token, p: FormulaCellPosition) => {
    const match = /^(\$?)[A-Z]+(\$?)\d+$/i.exec(token.value)!;
    return `${match[1]}${indexToColLetter(p.col)}${match[2]}${p.row + 1}`;
  };
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i]!;
    if (first.type !== 'CELL') continue;
    const second = tokens[i + 1]?.type === 'COLON' && tokens[i + 2]?.type === 'CELL' ? tokens[i + 2] : undefined;
    // Explicit references to other sheets are outside this evaluator's local-cell contract.
    if (tokens[i - 1]?.value === '!') { if (second) i += 2; continue; }
    const a = position(first);
    if (!second) {
      const next = moves.get(key(a));
      if (next) edits.push({ start: first.pos, end: first.pos + first.value.length, text: reference(first, next) });
      continue;
    }
    i += 2;
    const b = position(second), top = Math.min(a.row, b.row), bottom = Math.max(a.row, b.row),
      left = Math.min(a.col, b.col), right = Math.max(a.col, b.col), width = right - left + 1, height = bottom - top + 1;
    const destinations: FormulaCellPosition[] = [], rows = new Map<number, number>(), cols = new Map<number, number>();
    for (const [old, next] of moves) {
      const [row, col] = old.split(':').map(Number) as [number, number];
      if (row < top || row > bottom || col < left || col > right) continue;
      destinations.push(next); rows.set(row, (rows.get(row) || 0) + 1); cols.set(col, (cols.get(col) || 0) + 1);
    }
    if (!destinations.length) continue;
    let minRow = top, maxRow = bottom, minCol = left, maxCol = right;
    if (destinations.length === width * height) { minRow = minCol = Infinity; maxRow = maxCol = -Infinity; }
    else {
      while (rows.get(minRow) === width) minRow++;
      while (rows.get(maxRow) === width) maxRow--;
      while (cols.get(minCol) === height) minCol++;
      while (cols.get(maxCol) === height) maxCol--;
    }
    for (const p of destinations) { minRow = Math.min(minRow, p.row); maxRow = Math.max(maxRow, p.row); minCol = Math.min(minCol, p.col); maxCol = Math.max(maxCol, p.col); }
    if ((maxRow - minRow + 1) * (maxCol - minCol + 1) !== width * height)
      throw new Error(`排序会使公式范围 ${first.value}:${second.value} 不再连续，请先调整该公式的引用范围`);
    const start = { row: a.row <= b.row ? minRow : maxRow, col: a.col <= b.col ? minCol : maxCol },
      end = { row: a.row <= b.row ? maxRow : minRow, col: a.col <= b.col ? maxCol : minCol };
    edits.push({ start: first.pos, end: second.pos + second.value.length, text: `${reference(first, start)}:${reference(second, end)}` });
  }
  let result = formula;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

type ASTNode =
  | { kind: 'Number'; value: number }
  | { kind: 'String'; value: string }
  | { kind: 'Boolean'; value: boolean }
  | { kind: 'CellRef'; row: number; col: number; raw: string }
  | { kind: 'Range'; startRow: number; startCol: number; endRow: number; endCol: number; raw: string }
  | { kind: 'Unary'; op: '+' | '-' | '!'; expr: ASTNode }
  | { kind: 'Binary'; op: string; left: ASTNode; right: ASTNode }
  | { kind: 'Percent'; expr: ASTNode }
  | { kind: 'Call'; name: string; args: ASTNode[] };

class FormulaParser {
  private current = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  public parse(): ASTNode {
    const expr = this.parseLogicalOr();
    if (!this.isAtEnd() && this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token at end: "${this.peek().value}"`);
    }
    return expr;
  }

  private parseLogicalOr(): ASTNode {
    let expr = this.parseLogicalAnd();
    while (this.matchOp('||')) {
      const op = this.previous().value;
      const right = this.parseLogicalAnd();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parseLogicalAnd(): ASTNode {
    let expr = this.parseComparison();
    while (this.matchOp('&&')) {
      const op = this.previous().value;
      const right = this.parseComparison();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parseComparison(): ASTNode {
    let expr = this.parseConcat();
    while (
      this.matchOp('==') ||
      this.matchOp('!=') ||
      this.matchOp('<>') ||
      this.matchOp('<') ||
      this.matchOp('<=') ||
      this.matchOp('>') ||
      this.matchOp('>=')
    ) {
      const op = this.previous().value;
      const right = this.parseConcat();
      expr = { kind: 'Binary', op: op === '<>' ? '!=' : op, left: expr, right };
    }
    return expr;
  }

  private parseConcat(): ASTNode {
    let expr = this.parseAdditive();
    while (this.matchOp('&')) {
      const op = this.previous().value;
      const right = this.parseAdditive();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parseAdditive(): ASTNode {
    let expr = this.parseMultiplicative();
    while (this.matchOp('+') || this.matchOp('-')) {
      const op = this.previous().value;
      const right = this.parseMultiplicative();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parseMultiplicative(): ASTNode {
    let expr = this.parsePower();
    while (this.matchOp('*') || this.matchOp('/') || this.matchOp('%')) {
      const op = this.previous().value;
      const right = this.parsePower();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parsePower(): ASTNode {
    let expr = this.parseUnary();
    while (this.matchOp('^')) {
      const op = this.previous().value;
      const right = this.parseUnary();
      expr = { kind: 'Binary', op, left: expr, right };
    }
    return expr;
  }

  private parseUnary(): ASTNode {
    if (this.matchOp('+') || this.matchOp('-') || this.matchOp('!')) {
      const op = this.previous().value as '+' | '-' | '!';
      const operand = this.parseUnary();
      return { kind: 'Unary', op, expr: operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ASTNode {
    let expr = this.parsePrimary();
    while (this.matchType('PERCENT')) {
      expr = { kind: 'Percent', expr };
    }
    return expr;
  }

  private parsePrimary(): ASTNode {
    // 1. 数字字面量
    if (this.matchType('NUMBER')) {
      return { kind: 'Number', value: Number(this.previous().value) };
    }

    // 2. 字符串字面量
    if (this.matchType('STRING')) {
      return { kind: 'String', value: this.previous().value };
    }

    // 3. 布尔字面量
    if (this.matchType('BOOLEAN')) {
      return { kind: 'Boolean', value: this.previous().value === 'TRUE' };
    }

    // 4. 括号嵌套表达式
    if (this.matchType('LPAREN')) {
      const expr = this.parseLogicalOr();
      this.consume('RPAREN', '缺少闭合括号 ")"');
      return expr;
    }

    // 5. 单元格坐标或区域 (如 B2, B2:C2, $B$2)
    if (this.matchType('CELL')) {
      const cellToken = this.previous().value;
      const cellCoord = parseCellCoord(cellToken);
      if (!cellCoord) {
        throw new Error(`无法识别单元格坐标: "${cellToken}"`);
      }

      // 判断紧接着是否为冒号 (:) 构成区域引用 B2:C2
      if (this.matchType('COLON')) {
        const nextCellToken = this.consume('CELL', '区域引用 ":" 后面必须是单元格坐标').value;
        const nextCoord = parseCellCoord(nextCellToken);
        if (!nextCoord) {
          throw new Error(`无法识别区域结束单元格坐标: "${nextCellToken}"`);
        }
        return {
          kind: 'Range',
          startRow: cellCoord.row,
          startCol: cellCoord.col,
          endRow: nextCoord.row,
          endCol: nextCoord.col,
          raw: `${cellToken}:${nextCellToken}`,
        };
      }

      return {
        kind: 'CellRef',
        row: cellCoord.row,
        col: cellCoord.col,
        raw: cellToken,
      };
    }

    // 6. 函数调用 (如 MAX, SUM, IF)
    if (this.matchType('IDENT')) {
      const fnName = this.previous().value;
      this.consume('LPAREN', `函数 ${fnName} 后面缺少 "("`);
      const args: ASTNode[] = [];
      if (!this.check('RPAREN')) {
        do {
          args.push(this.parseLogicalOr());
        } while (this.matchType('COMMA'));
      }
      this.consume('RPAREN', `函数 ${fnName} 参数列表缺少闭合 ")"`);
      return {
        kind: 'Call',
        name: fnName,
        args,
      };
    }

    const t = this.peek();
    throw new Error(`意外标记: "${t.value || t.type}"`);
  }

  private matchType(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchOp(op: string): boolean {
    if (this.check('OP') && this.peek().value === op) {
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
    return this.tokens[this.current] || { type: 'EOF', value: '', pos: -1 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1]!;
  }

  private consume(type: TokenType, errMsg: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${errMsg}，当前标记: "${this.peek().value || this.peek().type}"`);
  }
}

function parseCellCoord(raw: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/i.exec(raw);
  if (!m || !m[1] || !m[2]) return null;
  const col = colLetterToIndex(m[1]);
  const row = parseInt(m[2], 10) - 1;
  return { row, col };
}

function isTruthy(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') return val !== 0 && !Number.isNaN(val);
  if (typeof val === 'string') return val.trim().length > 0 && val !== '0' && val.toLowerCase() !== 'false';
  return true;
}

function toNumber(val: any): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined || val === '') return 0;
  const parsed = Number(String(val).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function flattenNumbers(args: any[]): number[] {
  const res: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      res.push(...flattenNumbers(a));
    } else if (a !== null && a !== undefined && a !== '') {
      const n = Number(String(a).replace(/,/g, ''));
      if (!Number.isNaN(n)) {
        res.push(n);
      }
    }
  }
  return res;
}

function flattenAll(args: any[]): any[] {
  const res: any[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      res.push(...flattenAll(a));
    } else if (a !== null && a !== undefined && a !== '') {
      res.push(a);
    }
  }
  return res;
}

class FormulaEvaluator {
  constructor(
    private readonly cellAccessor: CellAccessor,
    private readonly currentR?: number,
    private readonly currentC?: number
  ) {}

  public eval(node: ASTNode): any {
    switch (node.kind) {
      case 'Number':
        return node.value;

      case 'String':
        return node.value;

      case 'Boolean':
        return node.value;

      case 'CellRef': {
        if (node.row === this.currentR && node.col === this.currentC) {
          return 0; // 自引用环路保护
        }
        return this.cellAccessor(node.row, node.col);
      }

      case 'Range': {
        const minR = Math.min(node.startRow, node.endRow);
        const maxR = Math.max(node.startRow, node.endRow);
        const minC = Math.min(node.startCol, node.endCol);
        const maxC = Math.max(node.startCol, node.endCol);

        const vals: any[] = [];
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            if (r === this.currentR && c === this.currentC) continue;
            const v = this.cellAccessor(r, c);
            if (v !== null && v !== undefined && v !== '') {
              vals.push(v);
            }
          }
        }
        return vals;
      }

      case 'Unary': {
        const val = this.eval(node.expr);
        if (node.op === '+') return toNumber(val);
        if (node.op === '-') return -toNumber(val);
        if (node.op === '!') return !isTruthy(val);
        return val;
      }

      case 'Percent': {
        const val = this.eval(node.expr);
        return toNumber(val) / 100;
      }

      case 'Binary': {
        if (node.op === '&&') {
          const left = this.eval(node.left);
          if (!isTruthy(left)) return false;
          return isTruthy(this.eval(node.right));
        }
        if (node.op === '||') {
          const left = this.eval(node.left);
          if (isTruthy(left)) return true;
          return isTruthy(this.eval(node.right));
        }

        const lVal = this.eval(node.left);
        const rVal = this.eval(node.right);

        switch (node.op) {
          case '+':
            return toNumber(lVal) + toNumber(rVal);
          case '-':
            return toNumber(lVal) - toNumber(rVal);
          case '*':
            return toNumber(lVal) * toNumber(rVal);
          case '/': {
            const d = toNumber(rVal);
            if (d === 0) return '#DIV/0!';
            return toNumber(lVal) / d;
          }
          case '%': {
            const d = toNumber(rVal);
            if (d === 0) return '#DIV/0!';
            return toNumber(lVal) % d;
          }
          case '^':
            return Math.pow(toNumber(lVal), toNumber(rVal));
          case '&':
            return String(lVal ?? '') + String(rVal ?? '');
          case '==':
            return lVal == rVal;
          case '!=':
            return lVal != rVal;
          case '>':
            return toNumber(lVal) > toNumber(rVal);
          case '>=':
            return toNumber(lVal) >= toNumber(rVal);
          case '<':
            return toNumber(lVal) < toNumber(rVal);
          case '<=':
            return toNumber(lVal) <= toNumber(rVal);
          default:
            return null;
        }
      }

      case 'Call': {
        const fn = node.name.toUpperCase();

        // IF 惰性求值
        if (fn === 'IF') {
          if (node.args.length < 2) {
            throw new Error('IF 函数需要至少 2 个参数');
          }
          const cond = this.eval(node.args[0]!);
          if (isTruthy(cond)) {
            return this.eval(node.args[1]!);
          } else {
            return node.args[2] ? this.eval(node.args[2]) : null;
          }
        }

        // IFERROR 容错求值
        if (fn === 'IFERROR') {
          try {
            const v = this.eval(node.args[0]!);
            if (isSheetError(v)) {
              return node.args[1] ? this.eval(node.args[1]) : null;
            }
            return v;
          } catch {
            return node.args[1] ? this.eval(node.args[1]) : null;
          }
        }

        const evalArgs = node.args.map((a) => this.eval(a));

        switch (fn) {
          case 'TEXT': {
            if (evalArgs.length !== 2 || typeof evalArgs[1] !== 'string' || Array.isArray(evalArgs[0])) return '#VALUE!';
            if (isSheetError(evalArgs[0])) return evalArgs[0];
            const pattern = evalArgs[1];
            if (pattern === '') return '';
            if (!isValidNumberFormat(pattern)) return '#VALUE!';
            try {
              return formatExcelValue(evalArgs[0] ?? 0, pattern);
            } catch {
              return '#VALUE!';
            }
          }
          case 'MAX': {
            const nums = flattenNumbers(evalArgs);
            return nums.length > 0 ? Math.max(...nums) : 0;
          }
          case 'MIN': {
            const nums = flattenNumbers(evalArgs);
            return nums.length > 0 ? Math.min(...nums) : 0;
          }
          case 'SUM': {
            const nums = flattenNumbers(evalArgs);
            return nums.reduce((s, v) => s + v, 0);
          }
          case 'AVERAGE':
          case 'AVG': {
            const nums = flattenNumbers(evalArgs);
            return nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
          }
          case 'COUNT': {
            const nums = flattenNumbers(evalArgs);
            return nums.length;
          }
          case 'COUNTA': {
            const all = flattenAll(evalArgs);
            return all.length;
          }
          case 'PRODUCT': {
            const nums = flattenNumbers(evalArgs);
            return nums.length > 0 ? nums.reduce((p, v) => p * v, 1) : 0;
          }
          case 'ROUND': {
            const num = toNumber(evalArgs[0]);
            const p = Math.floor(toNumber(evalArgs[1] ?? 0));
            const factor = 10 ** p;
            return Math.round(num * factor) / factor;
          }
          case 'ROUNDUP': {
            const num = toNumber(evalArgs[0]);
            const p = Math.floor(toNumber(evalArgs[1] ?? 0));
            const factor = 10 ** p;
            return (num >= 0 ? Math.ceil(num * factor) : Math.floor(num * factor)) / factor;
          }
          case 'ROUNDDOWN': {
            const num = toNumber(evalArgs[0]);
            const p = Math.floor(toNumber(evalArgs[1] ?? 0));
            const factor = 10 ** p;
            return (num >= 0 ? Math.floor(num * factor) : Math.ceil(num * factor)) / factor;
          }
          case 'ABS':
            return Math.abs(toNumber(evalArgs[0]));
          case 'INT':
            return Math.floor(toNumber(evalArgs[0]));
          case 'MOD': {
            const a = toNumber(evalArgs[0]);
            const b = toNumber(evalArgs[1]);
            return b === 0 ? '#DIV/0!' : ((a % b) + b) % b;
          }
          case 'POWER':
            return Math.pow(toNumber(evalArgs[0]), toNumber(evalArgs[1]));
          case 'SQRT': {
            const n = toNumber(evalArgs[0]);
            return n < 0 ? '#NUM!' : Math.sqrt(n);
          }
          case 'CEIL':
          case 'CEILING':
            return Math.ceil(toNumber(evalArgs[0]));
          case 'FLOOR':
            return Math.floor(toNumber(evalArgs[0]));
          case 'AND': {
            const all = flattenAll(evalArgs);
            return all.length > 0 && all.every(isTruthy);
          }
          case 'OR': {
            const all = flattenAll(evalArgs);
            return all.some(isTruthy);
          }
          case 'NOT':
            return !isTruthy(evalArgs[0]);
          case 'COALESCE':
          case 'IFNULL': {
            for (const a of evalArgs) {
              if (a !== null && a !== undefined && a !== '') return a;
            }
            return null;
          }
          case 'ISBLANK':
            return evalArgs[0] === null || evalArgs[0] === undefined || evalArgs[0] === '';
          case 'ISNUMBER':
            return typeof evalArgs[0] === 'number' && !Number.isNaN(evalArgs[0]);
          case 'ISTEXT':
            return typeof evalArgs[0] === 'string';
          case 'CONCAT':
          case 'CONCATENATE':
            return flattenAll(evalArgs).map((v) => String(v ?? '')).join('');
          case 'LEFT': {
            const s = String(evalArgs[0] ?? '');
            const count = Math.max(0, Math.floor(toNumber(evalArgs[1] ?? 1)));
            return s.slice(0, count);
          }
          case 'RIGHT': {
            const s = String(evalArgs[0] ?? '');
            const count = Math.max(0, Math.floor(toNumber(evalArgs[1] ?? 1)));
            return s.slice(Math.max(0, s.length - count));
          }
          case 'MID': {
            const s = String(evalArgs[0] ?? '');
            const start = Math.max(0, Math.floor(toNumber(evalArgs[1] ?? 1)) - 1);
            const len = Math.max(0, Math.floor(toNumber(evalArgs[2] ?? 0)));
            return s.substr(start, len);
          }
          case 'LEN':
            return String(evalArgs[0] ?? '').length;
          case 'UPPER':
            return String(evalArgs[0] ?? '').toUpperCase();
          case 'LOWER':
            return String(evalArgs[0] ?? '').toLowerCase();
          case 'TRIM':
            return String(evalArgs[0] ?? '').trim();
          case 'VALUE':
            return toNumber(evalArgs[0]);
          default:
            throw new Error(`ERR_UNSUPPORTED_SHEET_FORMULA: 未知或暂不支持的函数 "${fn}"`);
        }
      }
    }
  }
}

/**
 * 主执行入口：评估电子表格公式
 */
export function evaluateSheetFormula(
  formula: string,
  cellAccessor: CellAccessor,
  currentR?: number,
  currentC?: number
): SheetFormulaResult {
  let expr = formula.trim();
  if (expr.startsWith('=')) {
    expr = expr.substring(1).trim();
  }
  if (!expr) {
    return { value: '' };
  }

  try {
    const tokens = tokenizeFormula(expr);
    const parser = new FormulaParser(tokens);
    const ast = parser.parse();
    const evaluator = new FormulaEvaluator(cellAccessor, currentR, currentC);
    const result = evaluator.eval(ast);

    if (result === '#DIV/0!') {
      return { value: '#DIV/0!', error: 'ERR_DIVIDE_BY_ZERO' };
    }
    if (isSheetError(result)) {
      return { value: result, error: 'ERR_INVALID_SHEET_FORMULA' };
    }

    return { value: result };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('ERR_UNSUPPORTED_SHEET_FORMULA')) {
      return { value: null, error: 'ERR_UNSUPPORTED_SHEET_FORMULA' };
    }
    return { value: null, error: 'ERR_INVALID_SHEET_FORMULA' };
  }
}
