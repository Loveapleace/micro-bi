/** 源配置历史；数据刷新与程序投影不产生用户历史。每个快照均与调用方隔离。 */
export class HybridHistory<T> {
  private states: T[] = [];
  private cursor = -1;
  constructor(private readonly apply: (state: T) => void, private readonly limit = 50) {}

  get index(): number { return this.cursor; }
  get count(): number { return Math.max(0, this.states.length - 1); }
  reset(): void { this.states = []; this.cursor = -1; }
  commit(before: T, after: T): boolean {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    if (this.cursor < 0) { this.states = [structuredClone(before)]; this.cursor = 0; }
    this.states = this.states.slice(0, this.cursor + 1);
    this.states.push(structuredClone(after));
    if (this.states.length > this.limit + 1) this.states.shift();
    this.cursor = this.states.length - 1;
    return true;
  }
  moveTo(index: number): boolean {
    const state = this.states[index];
    if (!state || index === this.cursor) return false;
    this.cursor = index;
    this.apply(structuredClone(state));
    return true;
  }
}

/** 非变更命令（选区、滚动、复制等）不启动源事务；内部mutation由外层command归并。 */
export function isHybridHistoryCommand(id: string, type: number): boolean {
  return type === 0 && id.startsWith('sheet.command.') &&
    /(?:set-range|clear-|paste|cut|merge|insert-row|remove-row|insert-col|remove-col|row-height|col-width|column-width|auto-height|auto-width)/.test(id);
}
