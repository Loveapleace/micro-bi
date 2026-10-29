/** Univer CellValueType.BOOLEAN=3，原生快照可能用0/1保存；业务源保留布尔类型。 */
export function readUniverCellValue(cell: { v?: unknown; t?: number | null | undefined }): unknown {
  return cell.t === 3 && (cell.v === 0 || cell.v === 1) ? cell.v === 1 : cell.v;
}

/** 原生编辑器可能以文档保存多行标签；只去除SDK固定的末尾段落结束符。 */
export function readUniverLiteralValue(cell:{v?:unknown;t?:number|null|undefined;p?:any}):unknown {
  const value=readUniverCellValue(cell);
  if(value!==null&&value!==undefined)return value;
  const text=cell.p?.body?.dataStream;
  return typeof text==='string'?text.replace(/\r\n$/,''):value;
}
