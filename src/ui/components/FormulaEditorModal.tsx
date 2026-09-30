import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Input,
  InputNumber,
  Button,
  Space,
  Tag,
  Alert,
  Typography,
  Divider,
} from 'antd';
import {
  CalculatorOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ComputedColumnConfig, FieldMeta } from '../../engine/types.js';
import type { DataRecord } from '../../types.js';
import { parseFormula } from '../../engine/formula/parser.js';
import { evaluateFormula } from '../../engine/formula/evaluator.js';
import { useDynamicDataLocale } from '../../locale/index.js';
import { SimpleModal } from './common/SimpleModal.js';

const { Text } = Typography;

export interface FormulaEditorModalProps {
  readonly open: boolean;
  readonly initialValue?: ComputedColumnConfig | undefined;
  readonly availableFields: readonly FieldMeta[];
  readonly sampleRow?: DataRecord | undefined;
  readonly onOk: (col: ComputedColumnConfig) => void;
  readonly onCancel: () => void;
  readonly isDark?: boolean | undefined;
}

export const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({
  open,
  initialValue,
  availableFields,
  sampleRow,
  onOk,
  onCancel,
  isDark = false,
}) => {
  const t = useDynamicDataLocale();

  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [expression, setExpression] = useState('');
  const [precision, setPrecision] = useState<number | null>(2);
  const [scope, setScope] = useState<'row' | 'summary' | 'auto'>('auto');

  const [nameError, setNameError] = useState('');
  const [labelError, setLabelError] = useState('');

  // 引用文本域与光标位置记忆
  const textAreaRef = useRef<{
    resizableTextArea?: { textArea?: HTMLTextAreaElement };
    nativeElement?: HTMLElement;
    focus?: () => void;
  } | null>(null);
  const hasInteractedRef = useRef<boolean>(false);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // 获取原生 HTMLTextAreaElement 元素
  const getTextAreaElement = (): HTMLTextAreaElement | null => {
    if (!textAreaRef.current) return null;
    const ref = textAreaRef.current;
    if (ref.resizableTextArea?.textArea instanceof HTMLTextAreaElement) {
      return ref.resizableTextArea.textArea;
    }
    if (ref.nativeElement) {
      const el = ref.nativeElement.querySelector('textarea');
      if (el instanceof HTMLTextAreaElement) return el;
    }
    if (ref instanceof HTMLTextAreaElement) {
      return ref;
    }
    return null;
  };

  useEffect(() => {
    if (open) {
      if (initialValue) {
        setName(initialValue.name || '');
        setLabel(initialValue.label || '');
        setExpression(initialValue.expression || '');
        setPrecision(initialValue.precision ?? 2);
        setScope(initialValue.scope || 'auto');
        hasInteractedRef.current = false;
        const len = (initialValue.expression || '').length;
        selectionRef.current = { start: len, end: len };
      } else {
        const autoKey = `comp_${Date.now().toString().slice(-4)}`;
        setName(autoKey);
        setLabel(t('动态计算列'));
        setExpression('');
        setPrecision(2);
        setScope('auto');
        hasInteractedRef.current = false;
        selectionRef.current = { start: 0, end: 0 };
      }
      setNameError('');
      setLabelError('');
    }
  }, [open, initialValue, t]);

  // 插入文本到公式输入框的光标处或替换选中区域
  const handleInsertToken = (token: string) => {
    const el = getTextAreaElement();
    let start = expression.length;
    let end = expression.length;

    if (hasInteractedRef.current) {
      if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        start = el.selectionStart;
        end = el.selectionEnd;
      } else {
        start = selectionRef.current.start;
        end = selectionRef.current.end;
      }
    }

    start = Math.max(0, Math.min(start, expression.length));
    end = Math.max(start, Math.min(end, expression.length));

    // 智能空格优化（针对二元运算符自动处理两侧空格）
    let insertText = token;
    const isBinaryOp = ['+', '-', '*', '/', '%', '>', '<', '>=', '<=', '==', '!=', '&&', '||'].includes(token);
    if (isBinaryOp) {
      const prevChar = start > 0 ? expression[start - 1] : '';
      const nextChar = end < expression.length ? expression[end] : '';
      const needLeading = prevChar && prevChar !== ' ' && prevChar !== '(';
      const needTrailing = nextChar !== ' ' && nextChar !== ')';
      insertText = `${needLeading ? ' ' : ''}${token}${needTrailing ? ' ' : ''}`;
    }

    const prefix = expression.slice(0, start);
    const suffix = expression.slice(end);
    const nextExpr = prefix + insertText + suffix;

    // 计算插入后的光标/选中位置
    let newStart = start + insertText.length;
    let newEnd = newStart;

    // 针对模板函数，高亮选中占位符，方便用户立即输入替换
    if (token === 'IF(条件, "真值", "假值")') {
      const placeholder = '条件';
      const pIdx = insertText.indexOf(placeholder);
      if (pIdx !== -1) {
        newStart = start + pIdx;
        newEnd = newStart + placeholder.length;
      }
    } else if (token === 'ROUND(数值, 2)') {
      const placeholder = '数值';
      const pIdx = insertText.indexOf(placeholder);
      if (pIdx !== -1) {
        newStart = start + pIdx;
        newEnd = newStart + placeholder.length;
      }
    }

    // 更新状态与记录
    hasInteractedRef.current = true;
    selectionRef.current = { start: newStart, end: newEnd };

    if (el) {
      el.value = nextExpr;
      el.setSelectionRange(newStart, newEnd);
      el.focus();
    }
    setExpression(nextExpr);

    // 确保 React re-render 后光标位置不丢失并保持聚焦
    requestAnimationFrame(() => {
      const targetEl = getTextAreaElement();
      if (targetEl) {
        targetEl.focus();
        targetEl.setSelectionRange(newStart, newEnd);
      }
    });
  };

  // 实时语法验证与试算
  const validationResult = useMemo(() => {
    const trimmed = expression.trim();
    if (!trimmed) {
      return { valid: false, message: t('请输入公式表达式') };
    }
    try {
      parseFormula(trimmed);
      let trialVal: unknown = undefined;
      if (sampleRow) {
        trialVal = evaluateFormula(trimmed, sampleRow);
      }
      return {
        valid: true,
        trialVal,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('公式存在语法错误');
      return { valid: false, message: msg };
    }
  }, [expression, sampleRow, t]);

  const handleSubmit = () => {
    let hasErr = false;
    if (!name.trim()) {
      setNameError(t('请输入字段标识名'));
      hasErr = true;
    } else {
      setNameError('');
    }

    if (!label.trim()) {
      setLabelError(t('请输入表格列名'));
      hasErr = true;
    } else {
      setLabelError('');
    }

    if (!expression.trim() || !validationResult.valid || hasErr) {
      return;
    }

    const colConfig: ComputedColumnConfig = {
      type: 'computed',
      name: name.trim(),
      label: label.trim(),
      expression: expression.trim(),
      ...(precision !== null ? { precision } : {}),
      scope,
    };
    onOk(colConfig);
  };

  return (
    <SimpleModal
      title={
        <Space size={6}>
          <CalculatorOutlined style={{ color: '#1677ff' }} />
          <span>{initialValue ? t('编辑动态计算列') : t('新建动态计算列')}</span>
        </Space>
      }
      open={open}
      width={680}
      onOk={handleSubmit}
      onCancel={onCancel}
      okText={t('保存列配置')}
      cancelText={t('取消')}
      destroyOnClose
      isDark={isDark}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 顶部字段基本配置：唯一键、显示名、精度 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
              <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>
              {t('字段唯一 Key')}
            </div>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder={t('如: profit')}
              status={nameError ? 'error' : ''}
            />
            {nameError && (
              <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{nameError}</div>
            )}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
              <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>
              {t('表格显示名称 (Label)')}
            </div>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError('');
              }}
              placeholder={t('如: 利润额')}
              status={labelError ? 'error' : ''}
            />
            {labelError && (
              <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{labelError}</div>
            )}
          </div>

          <div style={{ width: 120 }}>
            <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
              {t('保留小数位')}
            </div>
            <InputNumber
              min={0}
              max={6}
              value={precision}
              onChange={(val) => setPrecision(typeof val === 'number' ? val : null)}
              placeholder={t('默认')}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <Divider style={{ margin: '4px 0 8px 0' }} />

        {/* 字段气泡点击插入 */}
        <div>
          <Text strong style={{ fontSize: 13, marginRight: 8 }}>
            {t('可用字段 (点击插入)：')}
          </Text>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 6,
              maxHeight: 80,
              overflowY: 'auto',
            }}
          >
            {availableFields.map((f) => (
              <Tag
                key={f.key}
                color={f.type === 'number' ? 'green' : f.type === 'time' ? 'blue' : 'orange'}
                style={{ cursor: 'pointer', padding: '2px 8px', userSelect: 'none' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleInsertToken(`[${f.key}]`)}
              >
                + [{f.label !== f.key ? `${f.label} (${f.key})` : f.key}]
              </Tag>
            ))}

            {availableFields
              .filter((f) => f.type === 'number')
              .map((f) => (
                <Tag
                  key={`sum_${f.key}`}
                  color="purple"
                  style={{ cursor: 'pointer', padding: '2px 8px', userSelect: 'none' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertToken(`[SUM(${f.key})]`)}
                >
                  + [SUM({f.label !== f.key ? f.label : f.key})]
                </Tag>
              ))}
          </div>
        </div>

        {/* 常用运算快捷符号 */}
        <div>
          <Text strong style={{ fontSize: 13, marginRight: 8 }}>
            {t('快捷符号：')}
          </Text>
          <Space wrap size={4} style={{ marginTop: 4 }}>
            {['+', '-', '*', '/', '(', ')', '>', '<', '>=', '<=', '==', '!=', '&&', '||'].map(
              (op) => (
                <Button
                  key={op}
                  size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertToken(op)}
                  style={{ fontWeight: 600 }}
                >
                  {op}
                </Button>
              )
            )}
            <Button
              size="small"
              type="dashed"
              icon={<ThunderboltOutlined />}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleInsertToken('IF(条件, "真值", "假值")')}
            >
              {t('IF 模板')}
            </Button>
            <Button
              size="small"
              type="dashed"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleInsertToken('ROUND(数值, 2)')}
            >
              ROUND
            </Button>
          </Space>
        </div>

        {/* 公式输入核心区域 */}
        <div>
          <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
            <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>
            {t('运算公式表达式')}
          </div>
          <Input.TextArea
            ref={textAreaRef as any}
            rows={4}
            value={expression}
            onChange={(e) => {
              setExpression(e.target.value);
              hasInteractedRef.current = true;
              selectionRef.current = {
                start: e.target.selectionStart,
                end: e.target.selectionEnd,
              };
            }}
            onSelect={(e) => {
              hasInteractedRef.current = true;
              selectionRef.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              };
            }}
            onClick={(e) => {
              hasInteractedRef.current = true;
              selectionRef.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              };
            }}
            onKeyUp={(e) => {
              hasInteractedRef.current = true;
              selectionRef.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              };
            }}
            onFocus={(e) => {
              hasInteractedRef.current = true;
              selectionRef.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              };
            }}
            onBlur={(e) => {
              selectionRef.current = {
                start: e.target.selectionStart,
                end: e.target.selectionEnd,
              };
            }}
            placeholder={t("示例: [sales] - [cost] 或 IF([sales] > 10000, '优质客户', '普通客户')")}
            style={{ fontFamily: 'monospace', fontSize: 14 }}
          />
        </div>

        {/* 实时校验与结果反馈 */}
        <div>
          {expression.trim() &&
            (validationResult.valid ? (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={
                  <Space size={8}>
                    <span>{t('语法合法！')}</span>
                    {validationResult.trialVal !== undefined && (
                      <Text type="secondary">
                        {t('(首条样本试算结果: {result})', {
                          result: String(validationResult.trialVal),
                        })}
                      </Text>
                    )}
                  </Space>
                }
              />
            ) : (
              <Alert
                type="error"
                showIcon
                icon={<CloseCircleOutlined />}
                message={validationResult.message}
              />
            ))}
        </div>
      </div>
    </SimpleModal>
  );
};
