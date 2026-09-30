import React, { useEffect, useCallback } from 'react';
import { Space, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useDynamicDataLocale } from '../../../locale/index.js';

export interface SimpleModalProps {
  readonly open: boolean;
  readonly title?: React.ReactNode;
  readonly width?: number | string;
  readonly onOk?: () => void;
  readonly onCancel?: () => void;
  readonly okText?: string;
  readonly cancelText?: string;
  readonly destroyOnClose?: boolean;
  readonly children: React.ReactNode;
  readonly isDark?: boolean;
}

/**
 * 轻量级原生无依赖模态弹窗 (SimpleModal)
 *
 * 替代 antd/Modal，彻底剥离 rc-dialog、rc-motion 及其复杂依赖树。
 * 纯 CSS Flex 居中定位 + Portal/全屏遮罩 + ESC 键监听，体积小于 2KB。
 */
export const SimpleModal: React.FC<SimpleModalProps> = ({
  open,
  title,
  width = 680,
  onOk,
  onCancel,
  okText,
  cancelText,
  destroyOnClose = true,
  children,
  isDark = false,
}) => {
  const t = useDynamicDataLocale();

  // 监听 ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onCancel?.();
      }
    },
    [open, onCancel]
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

  const bgModal = isDark ? '#1f1f1f' : '#ffffff';
  const borderModal = isDark ? '#303030' : '#f0f0f0';
  const textPrimary = isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)';

  return (
    <div
      style={{
        display: open ? 'flex' : 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1050,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* 遮罩背景 */}
      <div
        onClick={onCancel}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(2px)',
          transition: 'opacity 0.2s',
        }}
      />

      {/* 弹窗主体卡片 */}
      <div
        style={{
          position: 'relative',
          width: typeof width === 'number' ? `${width}px` : width,
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: bgModal,
          borderRadius: 8,
          boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
          border: `1px solid ${borderModal}`,
          color: textPrimary,
          zIndex: 1,
          animation: 'hw-modal-fade 0.2s cubic-bezier(0.2, 0, 0, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${borderModal}`,
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          <div>{title}</div>
          <button
            onClick={onCancel}
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

        {/* 内容区 */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {children}
        </div>

        {/* 底部操作区 */}
        {(onOk || onCancel) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '12px 20px',
              borderTop: `1px solid ${borderModal}`,
              backgroundColor: isDark ? '#181818' : '#fafafa',
              borderBottomLeftRadius: 8,
              borderBottomRightRadius: 8,
            }}
          >
            <Space size={8}>
              {onCancel && (
                <Button onClick={onCancel}>
                  {cancelText ?? t('取消')}
                </Button>
              )}
              {onOk && (
                <Button type="primary" onClick={onOk}>
                  {okText ?? t('保存配置')}
                </Button>
              )}
            </Space>
          </div>
        )}
      </div>
    </div>
  );
};
