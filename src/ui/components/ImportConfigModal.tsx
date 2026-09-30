/**
 * DSL 转换配置导入弹窗 (ImportConfigModal)
 *
 * 核心特性：
 * 1. 实时多维度数据合法性校验 (JSON 格式、Schema 规范、公式语法、字段兼容性)
 * 2. 一键从剪贴板读取粘贴
 * 3. 错误明细高亮与兼容性警示
 * 4. 导入后实时重载配置面板全量状态
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Input, Button, Space, Alert, Typography, message } from 'antd';
import {
  ImportOutlined,
  SnippetsOutlined,
  ClearOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { DynamicTransformConfig, FieldMeta } from '../../engine/types.js';
import { validateTransformConfig } from '../../engine/validator.js';
import { useDynamicDataLocale } from '../../locale/index.js';
import { SimpleModal } from './common/SimpleModal.js';

const { TextArea } = Input;
const { Text } = Typography;

export interface ImportConfigModalProps {
  /** 弹窗是否可见 */
  open: boolean;
  /** 确定导入回调 */
  onOk: (config: DynamicTransformConfig) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 当前数据源中的有效字段列表 (用于兼容性对比提示) */
  availableFields?: readonly FieldMeta[] | undefined;
  /** 当前面板配置 (可选，用于快捷填充草稿) */
  currentConfig?: DynamicTransformConfig | undefined;
}

export const ImportConfigModal: React.FC<ImportConfigModalProps> = ({
  open,
  onOk,
  onCancel,
  availableFields,
  currentConfig,
}) => {
  const t = useDynamicDataLocale();
  const [jsonText, setJsonText] = useState('');

  // 每次打开弹窗时重置输入
  useEffect(() => {
    if (open) {
      setJsonText('');
    }
  }, [open]);

  // 实时执行配置合法性校验
  const validationResult = useMemo(() => {
    if (!jsonText.trim()) {
      return null;
    }
    return validateTransformConfig(jsonText, availableFields);
  }, [jsonText, availableFields]);

  // 从剪贴板读取一键粘贴
  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        message.warning(t('当前环境不支持直接读取剪贴板，请手动使用 Ctrl+V / Cmd+V 粘贴'));
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        message.warning(t('剪贴板中没有文本内容'));
        return;
      }
      setJsonText(text);
      message.success(t('已从剪贴板读入配置内容'));
    } catch {
      message.warning(t('读取剪贴板失败，请手动在输入框中粘贴内容'));
    }
  };

  // 快捷填入当前配置草稿
  const handleLoadCurrent = () => {
    if (!currentConfig) return;
    setJsonText(JSON.stringify(currentConfig, null, 2));
    message.info(t('已载入当前配置作为参考草稿'));
  };

  const handleConfirm = () => {
    if (!validationResult || !validationResult.valid || !validationResult.parsedConfig) {
      message.error(t('当前配置未通过合法性校验，请修正后再导入'));
      return;
    }
    onOk(validationResult.parsedConfig);
    message.success(t('配置导入成功！已同步应用至配置面板与实时试算'));
  };

  // 错误项与告警项拆分
  const errorIssues = validationResult?.issues.filter((i) => i.severity === 'error') ?? [];
  const warningIssues = validationResult?.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <SimpleModal
      title={
        <Space align="center">
          <ImportOutlined style={{ color: '#1677ff' }} />
          <span>{t('导入 DSL 转换配置')}</span>
        </Space>
      }
      open={open}
      onOk={handleConfirm}
      onCancel={onCancel}
      width={700}
      destroyOnClose
      okText={t('确认导入并生效')}
      cancelText={t('取消')}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('请将通过【复制配置】导出的 JSON 代码粘贴至下方输入框。系统将自动进行语法、列定义契约、公式表达式以及字段兼容性多层校验。')}
        </Text>
      </div>

      {/* 辅助操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space size={8}>
          <Button
            size="small"
            icon={<SnippetsOutlined />}
            onClick={handlePasteFromClipboard}
          >
            {t('从剪贴板读取')}
          </Button>
          {currentConfig && (
            <Button size="small" onClick={handleLoadCurrent}>
              {t('填入当前配置')}
            </Button>
          )}
        </Space>
        {jsonText && (
          <Button
            size="small"
            type="text"
            danger
            icon={<ClearOutlined />}
            onClick={() => setJsonText('')}
          >
            {t('清空')}
          </Button>
        )}
      </div>

      {/* JSON 输入域 */}
      <TextArea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        placeholder={t('在此粘贴 DynamicTransformConfig JSON 规范配置代码...')}
        autoSize={{ minRows: 9, maxRows: 16 }}
        style={{
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          borderRadius: 6,
          backgroundColor: '#fafafa',
        }}
        spellCheck={false}
      />

      {/* 校验状态反馈反馈区 */}
      <div style={{ marginTop: 12 }}>
        {!validationResult ? (
          <Alert
            type="info"
            showIcon
            message={t('等待输入配置内容')}
            description={t('粘贴 JSON 内容后，系统将自动进行格式和数据合法性校验。')}
          />
        ) : !validationResult.valid ? (
          <Alert
            type="error"
            showIcon
            icon={<CloseCircleOutlined />}
            message={t('配置校验未通过 (发现 {count} 处格式错误)', { count: errorIssues.length })}
            description={
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {errorIssues.map((issue, idx) => (
                  <li key={idx} style={{ margin: '2px 0' }}>
                    <Text code style={{ fontSize: 11 }}>{issue.path}</Text>: {issue.message}
                  </li>
                ))}
              </ul>
            }
          />
        ) : warningIssues.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={t('配置整体结构与公式语法符合规范，可正常导入。但以下字段在当前数据集中未被声明：')}
            description={
              <div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {warningIssues.map((issue, idx) => (
                    <li key={idx} style={{ margin: '2px 0' }}>
                      <Text code style={{ fontSize: 11 }}>{issue.path}</Text>: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            }
          />
        ) : (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message={t('配置合法性校验全部通过！')}
            description={
              <div>
                {t('已成功解析目标配置，包含 {columns} 个输出列{dimensions}。点击下方按钮即可完成导入。', {
                  columns: validationResult.parsedConfig?.columns.length ?? 0,
                  dimensions: validationResult.parsedConfig?.dimensions
                    ? ` (${
                        validationResult.parsedConfig.dimensions.timeBucket
                          ? `${t('时间分桶')}: ${validationResult.parsedConfig.dimensions.timeBucket.field}`
                          : ''
                      }${
                        validationResult.parsedConfig.dimensions.categories?.length
                          ? ` ${t('分类维度')}: ${validationResult.parsedConfig.dimensions.categories.join(', ')}`
                          : ''
                      })`
                    : t('（全量明细模式）'),
                })}
              </div>
            }
          />
        )}
      </div>
    </SimpleModal>
  );
};
