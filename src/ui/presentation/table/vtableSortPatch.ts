/**
 * VisActor VTable 底部总计行排序隔离补丁
 *
 * 核心问题：
 * VTable 在列头点击排序时，会针对 options.records 全量进行索引重排 (DataSource.prototype.sort)。
 * 当启用了底部总计行与冻结行 (bottomFrozenRowCount: 1) 时，总计行作为一个普通 record 混在 records 数组中，
 * 若度量或维度值参与排序，在倒序 (DESC) 或极端值情况下，总计行会被排至首行或中间，导致真实数据行被顶到底部冻结区。
 *
 * 补丁效果：
 * 在 DataSource.prototype.sort 比较每两行数据 indexA 和 indexB 时，
 * 若某行带有 __isSummaryRow 标识，则将其强制排至所有普通数据行的末尾（永远固定在尾部）：
 * - isSummaryA && !isSummaryB => return 1  (A 排在 B 后面)
 * - !isSummaryA && isSummaryB => return -1 (A 排在 B 前面)
 * - isSummaryA && isSummaryB  => return indexA - indexB
 *
 * 从而确保：无论用户如何进行升序、降序或切换排序列，总计行均完全不参与排序，且永远固定在表格最底部！
 */
import * as VTablePkg from '@visactor/vtable';

const vtableMod: any = VTablePkg;
const vtableActual = vtableMod.ListTable ? vtableMod : (vtableMod['def' + 'ault'] || vtableMod);
const DataSource = vtableActual.data?.DataSource;

let isPatchApplied = false;

export function applyVTableSummaryRowSortPatch(): void {
  try {
    if (isPatchApplied || !DataSource || !DataSource.prototype) {
      return;
    }

    isPatchApplied = true;

  DataSource.prototype.sort = function (states: any) {
    states = (Array.isArray(states) ? states : [states]).filter((state: any) => {
      const column = this.columns.find((obj: any) => obj.field === state.field);
      return !1 !== (null == column ? void 0 : column.sort) && 'normal' !== state.order;
    });
    this.lastSortStates = states;

    let filedMapArray = states.map((state: any) => this.sortedIndexMap.get(null == state ? void 0 : state.field) || {
      asc: [],
      desc: [],
      normal: []
    });

    let orderedData = null;
    if (
      filedMapArray.length > 0 &&
      (orderedData = states.reduce((data: any, state: any, index: number) => {
        const currentData = filedMapArray[index]?.[state.order];
        return currentData && currentData.length > 0 ? currentData : data;
      }, null),
      orderedData && orderedData.length > 0)
    ) {
      this.currentIndexedData = orderedData;
      this.updatePagerData();
      this.fireListeners(DataSource.EVENT_TYPE.CHANGE_ORDER, null);
      return;
    }

    const sortedIndexArray = Array.from({ length: this._sourceLength }, (_, i) => i);
    sortedIndexArray.sort((indexA: number, indexB: number) => {
      const recordA = this.getOriginalRecord(indexA);
      const recordB = this.getOriginalRecord(indexB);

      // 【核心防护】总计行永远锁定在数组最尾部，绝对不参与业务数据排序
      const isSumA = !!(recordA && (recordA as any).__isSummaryRow);
      const isSumB = !!(recordB && (recordB as any).__isSummaryRow);
      if (isSumA && !isSumB) return 1;
      if (!isSumA && isSumB) return -1;
      if (isSumA && isSumB) return indexA - indexB;

      const isEmptyA = null == recordA || ('object' == typeof recordA && 0 === Object.keys(recordA).length);
      const isEmptyB = null == recordB || ('object' == typeof recordB && 0 === Object.keys(recordB).length);

      return states.reduce((result: number, state: any) => {
        if (0 !== result) return result;
        if ('asc' === state.order || 'desc' === state.order) {
          if (isEmptyA && !isEmptyB) return 1;
          if (!isEmptyA && isEmptyB) return -1;
          if (isEmptyA && isEmptyB) return indexA - indexB;
        } else if (isEmptyA || isEmptyB) return indexA - indexB;

        const v1 = this.getOriginalField(indexA, state.field);
        const v2 = this.getOriginalField(indexB, state.field);

        if (state.orderFn) {
          return state.orderFn(v1, v2, state.order);
        }

        if (v1 === v2) return 0;
        if (v1 === null || v1 === undefined || v1 === '') return 1;
        if (v2 === null || v2 === undefined || v2 === '') return -1;

        const isAsc = state.order !== 'desc';
        const num1 = Number(v1);
        const num2 = Number(v2);
        if (!isNaN(num1) && !isNaN(num2)) {
          return isAsc ? (num1 > num2 ? 1 : -1) : (num1 < num2 ? 1 : -1);
        }

        const str1 = String(v1);
        const str2 = String(v2);
        const cmp = str1.localeCompare(str2, 'zh-CN', { numeric: true });
        return isAsc ? cmp : -cmp;
      }, 0);
    });

    this.currentIndexedData = sortedIndexArray;

    if (this.hierarchyExpandLevel && 'tree' === this.rowHierarchyType) {
      let nodeLength = sortedIndexArray.length;
      for (let i = 0; i < nodeLength; i++) {
        const record = this.getOriginalRecord(sortedIndexArray[i]);
        const subNodeLength = this.pushChildrenNode(
          sortedIndexArray[i],
          record.hierarchyState,
          this.getOriginalRecord(sortedIndexArray[i])
        );
        nodeLength += subNodeLength;
        i += subNodeLength;
      }
    }

    if (!filedMapArray.length) {
      filedMapArray = states.map(() => ({ asc: [], desc: [], normal: [] }));
      for (let index = 0; index < states.length; index++) {
        this.sortedIndexMap.set(states[index].field, filedMapArray[index]);
      }
    }

    states.forEach((state: any, index: number) => {
      filedMapArray[index][state.order] = sortedIndexArray.slice();
    });

    this.updatePagerData();
    this.fireListeners(DataSource.EVENT_TYPE.CHANGE_ORDER, null);
  };
  } catch (err) {
    console.warn('[VTablePatch] Failed to apply summary row sort patch safely:', err);
  }
}
