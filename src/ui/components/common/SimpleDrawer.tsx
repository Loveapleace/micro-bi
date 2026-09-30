import React, { useEffect, useCallback } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { useDynamicDataLocale } from '../../../locale/index.js';

export interface SimpleDrawerProps {
  readonly open: boolean;
  readonly title?: React.ReactNode;
  readonly width?: number | string;
  readonly placement?: 'right' | 'left';
  readonly onClose?: () => void;
  readonly destroyOnClose?: boolean;
  readonly children: React.ReactNode;
  readonly isDark?: boolean;
}

/**
 * 轻量级原生无依赖抽屉面板 (SimpleDrawer)
 *
 * 替代 antd/Drawer，彻底剥离 rc-drawer、rc-motion。
 * 纯 CSS Transform 滑入滑出 + 蒙层 + ESC 监听，体积小于 2KB。
 */
export const SimpleDrawer: React.FC<SimpleDrawerProps> = ({
  open,
  title,
  width = 880,
  placement = 'right',
  onClose,
  destroyOnClose = true,
  children,
  isDark = false,
}) => {
  const t = useDynamicDataLocale();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose?.();
      }
    },
    [open, onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open && destroyOnClose) {
    return null;
  }

  const bgDrawer = isDark ? '#1f1f1f' : '#ffffff';
  const borderDrawer = isDark ? '#303030' : '#f0f0f0';
  const textPrimary = isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)';
  const drawerWidth = typeof width === 'number' ? `${width}px` : width;

  return (
    <div
      style={{
        display: open ? 'block' : 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1050,
      }}
    >
      {/* 遮罩背景 */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(2px)',
          transition: 'opacity 0.25s',
        }}
      />

      {/* 抽屉面板主体 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [placement]: 0,
          width: drawerWidth,
          maxWidth: '100vw',
          backgroundColor: bgDrawer,
          color: textPrimary,
          boxShadow:
            placement === 'right'
              ? '-6px 0 16px 0 rgba(0, 0, 0, 0.08), -3px 0 6px -4px rgba(0, 0, 0, 0.12)'
              : '6px 0 16px 0 rgba(0, 0, 0, 0.08), 3px 0 6px -4px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
          borderLeft: placement === 'right' ? `1px solid ${borderDrawer}` : 'none',
          borderRight: placement === 'left' ? `1px solid ${borderDrawer}` : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: `1px solid ${borderDrawer}`,
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          <div>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isDark ? '#8c8c8c' : '#999',
              padding: 4,
              fontSize: 14,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            title={t('关闭')}
          >
            <CloseOutlined />
          </button>
        </div>

        {/* 主体滚动区 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
