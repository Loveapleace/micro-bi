import React from 'react';
import { ConfigProvider, Modal, theme } from 'antd';
import { useDynamicDataLocale } from '../../../locale/index.js';

export interface ReportModalProps {
  readonly open: boolean;
  readonly title?: React.ReactNode;
  readonly width?: number | string;
  readonly onOk?: () => void;
  readonly onCancel?: () => void;
  readonly okText?: string;
  readonly cancelText?: string;
  readonly destroyOnHidden?: boolean;
  readonly children: React.ReactNode;
  readonly isDark?: boolean;
}

/** 只维护报表主题与文案；Portal、焦点、嵌套层级、ESC与滚动锁交给AntD。 */
export function ReportModal({
  open, title, width = 680, onOk, onCancel, okText, cancelText,
  destroyOnHidden = true, children, isDark = false,
}: ReportModalProps) {
  const t = useDynamicDataLocale();
  return (
    <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      <Modal
        open={open}
        title={title}
        width={width}
        centered
        destroyOnHidden={destroyOnHidden}
        transitionName=""
        maskTransitionName=""
        onOk={() => onOk?.()}
        onCancel={() => onCancel?.()}
        okText={okText || t('确定')}
        cancelText={cancelText || t('取消')}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {children}
      </Modal>
    </ConfigProvider>
  );
}
