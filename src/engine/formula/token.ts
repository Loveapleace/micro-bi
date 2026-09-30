/**
 * 动态列公式词法 Token 与 AST 节点类型定义。
 */

export type TokenType =
  | 'FIELD'       // [sales]
  | 'NUMBER'      // 123, 45.67
  | 'STRING'      // 'abc', "def"
  | 'BOOLEAN'     // true, false
  | 'OPERATOR'    // +, -, *, /, %
  | 'COMPARISON'  // >, <, >=, <=, ==, !=, =
  | 'LOGICAL'     // &&, ||, !, AND, OR, NOT
  | 'IDENTIFIER'  // IF, ROUND, ABS, 等内置函数名
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'COMMA'       // ,
  | 'EOF';

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
}

/** AST 节点基类 */
export type ASTNode =
  | LiteralNode
  | FieldRefNode
  | BinaryOpNode
  | UnaryOpNode
  | IfNode
  | CallNode;

export interface LiteralNode {
  readonly kind: 'Literal';
  readonly value: string | number | boolean;
}

export interface FieldRefNode {
  readonly kind: 'FieldRef';
  readonly fieldName: string;
}

export interface BinaryOpNode {
  readonly kind: 'BinaryOp';
  readonly operator: string;
  readonly left: ASTNode;
  readonly right: ASTNode;
}

export interface UnaryOpNode {
  readonly kind: 'UnaryOp';
  readonly operator: string;
  readonly argument: ASTNode;
}

export interface IfNode {
  readonly kind: 'If';
  readonly condition: ASTNode;
  readonly consequent: ASTNode;
  readonly alternate: ASTNode;
}

export interface CallNode {
  readonly kind: 'Call';
  readonly functionName: string;
  readonly args: readonly ASTNode[];
}
