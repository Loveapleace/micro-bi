import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/es/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

// Bundled React18/AntD5 modules never enter the platform's React17 tree.
const embeddedTheme = { token: { zIndexPopupBase: 100000 } };
dayjs.locale('zh-cn');
ConfigProvider.config({ prefixCls: 'mbi', iconPrefixCls: 'mbiicon', holderRender: child => <ConfigProvider prefixCls="mbi" iconPrefixCls="mbiicon" locale={zhCN} theme={embeddedTheme}>{child}</ConfigProvider> });
export function createEmbeddedRoot(element: HTMLElement) {
  element.dataset.microBiRoot = 'true';
  element.style.height = '100%';
  element.style.minHeight = '0';
  element.style.fontFamily = 'Arial, sans-serif';
  element.tabIndex = -1;
  element.style.outline = 'none';
  const focusCanvas = (event: PointerEvent) => { if ((event.target as HTMLElement)?.tagName === 'CANVAS') element.focus({ preventScroll: true }); };
  element.addEventListener('pointerdown', focusCanvas, true);
  const root = createRoot(element);
  let disposed = false;
  return {
    render: (child: React.ReactNode) => {
      if (!disposed) root.render(<ConfigProvider prefixCls="mbi" iconPrefixCls="mbiicon" locale={zhCN} theme={embeddedTheme} getPopupContainer={() => element.ownerDocument.body}>{child}</ConfigProvider>);
    },
    unmount: () => { if (!disposed) { disposed = true; element.removeEventListener('pointerdown', focusCanvas, true); root.unmount(); delete element.dataset.microBiRoot; delete element.dataset.microBiDesigner; } },
  };
}
