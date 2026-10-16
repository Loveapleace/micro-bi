/**
 * Univer 实例生命周期与环境适配器 (adapter.ts)
 * 遵循 Section 15:
 * 1. 严格的 SSR / Node.js 保护，杜绝无 DOM 环境自动实例化
 * 2. 封装 createUniver 与 UniverSheetsCorePreset 注册
 * 3. 异步公式计算稳定判定 (waitForFormulaSettled)
 * 4. 实例与事件完整释放清理 (dispose)
 */
import { LocaleType, type IWorkbookData, type Univer } from '@univerjs/core';
import { createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/lib/es/locales/zh-CN.js';

export type FUniver = ReturnType<typeof createUniver>['univerAPI'];

export const isBrowser =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof window.document?.createElement === 'function';

export interface UniverInstanceBundle {
  univer: Univer;
  univerAPI: FUniver;
  dispose: () => void;
}

export function initUniver(
  container: HTMLElement,
  options: {
    initialSnapshot?: Partial<IWorkbookData> | undefined;
  } = {}
): UniverInstanceBundle | null {
  if (!isBrowser) {
    console.warn('[UniverAdapter] 当前处于非浏览器或 SSR 环境，跳过 Univer 初始化');
    return null;
  }

  try {
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: zhCN as any,
      },
      presets: [
        UniverSheetsCorePreset({
          container,
          header: true,
        }),
      ],
    });

    // 如果传入了初始工作簿快照，创建工作簿
    if (options.initialSnapshot) {
      univerAPI.createWorkbook(options.initialSnapshot);
    }

    const dispose = () => {
      try {
        univer.dispose();
      } catch (err) {
        console.warn('[UniverAdapter] 释放实例出现警告:', err);
      }
    };

    return {
      univer,
      univerAPI,
      dispose,
    };
  } catch (error) {
    console.error('[UniverAdapter] 初始化 Univer 失败:', error);
    return null;
  }
}

/**
 * 等待公式引擎计算完成并落地至单元格 (MBI-09)
 * 优先监听公式引擎 onCalculationResultApplied 事件，并提供安全超时保护
 */
export async function waitForFormulaSettled(
  univerAPI?: FUniver,
  timeoutMs = 300
): Promise<void> {
  if (!univerAPI) return;

  try {
    const formulaApi = (univerAPI as any).getFormula?.();
    if (formulaApi && typeof formulaApi.onCalculationResultApplied === 'function') {
      return await new Promise<void>((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, timeoutMs);

        try {
          const dispose = formulaApi.onCalculationResultApplied(() => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              if (typeof dispose === 'function') {
                try { dispose(); } catch {}
              }
              resolve();
            }
          });
        } catch {
          // 若注册失败直接回退定时器
        }
      });
    }
  } catch {
    // fallback
  }

  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(timeoutMs, 150));
  });
}
